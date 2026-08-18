#!/usr/bin/env python3
"""NVIDIA Model Live Test Runner — tests all 29 models with real API calls.

Usage:
    python -m backend.scripts.test_nvidia_models --all
    python -m backend.scripts.test_nvidia_models --model gemma-4-31b-it
    python -m backend.scripts.test_nvidia_models --type chat
    python -m backend.scripts.test_nvidia_models --active-only
    python -m backend.scripts.test_nvidia_models --include-deprecated
    python -m backend.scripts.test_nvidia_models --streaming
    python -m backend.scripts.test_nvidia_models --reasoning
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import traceback
from dataclasses import dataclass, field, asdict
from typing import Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.services.nvidia_model_registry import (
    NVIDIA_MODELS,
    NVIDIAModelRegistry,
    ModelDefinition,
    ModelType,
    EndpointType,
    nvidia_model_registry,
)
from backend.services.nvidia_adapters import ADAPTER_MAP
from backend.services.nvidia_adapters.base import AdapterResult


@dataclass
class TestResult:
    display_name: str
    model_id: str
    type: str
    adapter: str
    endpoint: str
    deprecated: bool
    http_status: Optional[int]= None
    status: str = "pending"
    latency_ms: float = 0
    content: str = ""
    reasoning: Optional[str]= None
    error: Optional[str]= None
    error_class: Optional[str]= None
    streaming: bool = False
    first_chunk_latency_ms: Optional[float]= None
    number_of_chunks: int = 0
    reasoning_detected: bool = False
    content_detected: bool = False
    embedding_dimension: Optional[int]= None
    rerank_scores: list[dict] | None = None
    safety_result: Optional[str]= None
    params_used: dict = field(default_factory=dict)


def classify_error(error: str, http_status: Optional[int]= None) -> str:
    if http_status == 400:
        return "configuration_error"
    if http_status in (401, 403):
        return "auth_error"
    if http_status == 404:
        return "model_not_found"
    if http_status == 410:
        return "retired"
    if http_status == 429:
        return "rate_limited"
    if http_status and 500 <= http_status < 600:
        return "provider_error"
    if "timeout" in error.lower():
        return "timeout"
    if "not found" in error.lower() or "does not exist" in error.lower():
        return "model_not_found"
    if "rate" in error.lower() or "limit" in error.lower():
        return "rate_limited"
    if "auth" in error.lower() or "api key" in error.lower():
        return "auth_error"
    return "provider_error"


async def test_chat_model(
    model_def: ModelDefinition, api_key: str, base_url: str
) -> TestResult:
    result = TestResult(
        display_name=model_def.display_name,
        model_id=model_def.model_id,
        type=model_def.type.value,
        adapter=model_def.adapter,
        endpoint=model_def.endpoint.value,
        deprecated=model_def.deprecated_date is not None,
    )

    adapter_cls = ADAPTER_MAP.get(model_def.adapter)
    if not adapter_cls:
        result.status = "error"
        result.error = f"Unknown adapter: {model_def.adapter}"
        return result

    adapter = adapter_cls(api_key=api_key, base_url=base_url)
    messages = [{"role": "user", "content": "Reply exactly with: OK"}]

    start = time.monotonic()
    try:
        chat_result: AdapterResult = await adapter.invoke(
            model_def, messages, stream=False
        )
        result.latency_ms = (time.monotonic() - start) * 1000

        result.content = chat_result.content or ""
        result.reasoning = chat_result.reasoning
        result.error = chat_result.error
        result.reasoning_detected = bool(chat_result.reasoning)
        result.content_detected = bool(chat_result.content)
        result.params_used = model_def.source_parameters

        if chat_result.success:
            result.status = "healthy"
        else:
            result.error_class = classify_error(chat_result.error or "")
            result.status = "failed"

    except Exception as e:
        result.latency_ms = (time.monotonic() - start) * 1000
        result.error = str(e)
        result.error_class = classify_error(str(e))
        result.status = "error"

    return result


async def test_streaming_model(
    model_def: ModelDefinition, api_key: str, base_url: str
) -> TestResult:
    result = TestResult(
        display_name=model_def.display_name,
        model_id=model_def.model_id,
        type=model_def.type.value,
        adapter=model_def.adapter,
        endpoint=model_def.endpoint.value,
        deprecated=model_def.deprecated_date is not None,
        streaming=True,
    )

    adapter_cls = ADAPTER_MAP.get(model_def.adapter)
    if not adapter_cls:
        result.status = "error"
        result.error = f"Unknown adapter: {model_def.adapter}"
        return result

    adapter = adapter_cls(api_key=api_key, base_url=base_url)
    messages = [{"role": "user", "content": "Reply exactly with: OK"}]

    start = time.monotonic()
    try:
        chat_result: AdapterResult = await adapter.invoke(
            model_def, messages, stream=True
        )
        total_latency = (time.monotonic() - start) * 1000

        if chat_result.success and chat_result.stream_object:
            chunks = 0
            first_chunk_time = None
            content_parts = []
            reasoning_parts = []

            for chunk in chat_result.stream_object:
                if not getattr(chunk, "choices", None):
                    continue
                if len(chunk.choices) == 0:
                    continue
                delta = getattr(chunk.choices[0], "delta", None)
                if delta is None:
                    continue

                if first_chunk_time is None:
                    first_chunk_time = time.monotonic()

                chunks += 1
                content = getattr(delta, "content", None)
                reasoning = getattr(delta, "reasoning_content", None)
                if content:
                    content_parts.append(content)
                if reasoning:
                    reasoning_parts.append(reasoning)

            result.number_of_chunks = chunks
            result.first_chunk_latency_ms = (
                (first_chunk_time - start) * 1000 if first_chunk_time else None
            )
            result.latency_ms = total_latency
            result.content = "".join(content_parts)
            result.reasoning = "".join(reasoning_parts) if reasoning_parts else None
            result.reasoning_detected = bool(reasoning_parts)
            result.content_detected = bool(content_parts)
            result.status = "healthy" if chunks > 0 else "empty_stream"
        else:
            result.latency_ms = total_latency
            result.error = chat_result.error
            result.error_class = classify_error(chat_result.error or "")
            result.status = "failed"

    except Exception as e:
        result.latency_ms = (time.monotonic() - start) * 1000
        result.error = str(e)
        result.error_class = classify_error(str(e))
        result.status = "error"

    return result


async def test_embedding_model(
    model_def: ModelDefinition, api_key: str, base_url: str
) -> TestResult:
    result = TestResult(
        display_name=model_def.display_name,
        model_id=model_def.model_id,
        type=model_def.type.value,
        adapter=model_def.adapter,
        endpoint=model_def.endpoint.value,
        deprecated=model_def.deprecated_date is not None,
    )

    adapter_cls = ADAPTER_MAP.get(model_def.adapter)
    if not adapter_cls:
        result.status = "error"
        result.error = f"Unknown adapter: {model_def.adapter}"
        return result

    adapter = adapter_cls(api_key=api_key, base_url=base_url)
    messages = [{"role": "user", "content": "What is the capital of France?"}]

    start = time.monotonic()
    try:
        emb_result: AdapterResult = await adapter.invoke(model_def, messages)
        result.latency_ms = (time.monotonic() - start) * 1000
        result.params_used = model_def.source_parameters

        if emb_result.success:
            try:
                import ast
                embedding = ast.literal_eval(emb_result.content)
                if isinstance(embedding, list) and len(embedding) > 0:
                    all_numeric = all(isinstance(x, (int, float)) for x in embedding)
                    if all_numeric:
                        result.status = "healthy"
                        result.embedding_dimension = len(embedding)
                        result.content = f"dim={len(embedding)}, sample={embedding[:3]}"
                    else:
                        result.status = "invalid_embedding"
                        result.error = "Not all elements are numeric"
                else:
                    result.status = "invalid_embedding"
                    result.error = f"Expected list, got {type(embedding)}"
            except Exception as e:
                result.status = "parse_error"
                result.error = str(e)
        else:
            result.error = emb_result.error
            result.error_class = classify_error(emb_result.error or "")
            result.status = "failed"

    except Exception as e:
        result.latency_ms = (time.monotonic() - start) * 1000
        result.error = str(e)
        result.error_class = classify_error(str(e))
        result.status = "error"

    return result


async def test_rerank_model(
    model_def: ModelDefinition, api_key: str, base_url: str
) -> TestResult:
    result = TestResult(
        display_name=model_def.display_name,
        model_id=model_def.model_id,
        type=model_def.type.value,
        adapter=model_def.adapter,
        endpoint=model_def.endpoint.value,
        deprecated=model_def.deprecated_date is not None,
    )

    adapter_cls = ADAPTER_MAP.get(model_def.adapter)
    if not adapter_cls:
        result.status = "error"
        result.error = f"Unknown adapter: {model_def.adapter}"
        return result

    adapter = adapter_cls(api_key=api_key, base_url=base_url)
    query = "What is the GPU memory bandwidth of H100 SXM?"
    passages = [
        {"text": "The Hopper GPU is paired with the Grace CPU using NVIDIA's ultra-fast chip-to-chip interconnect, delivering 900GB/s of bandwidth, 7X faster than PCIe Gen5."},
        {"text": "A100 provides up to 20X higher performance over the prior generation and can be partitioned into seven GPU instances."},
        {"text": "Accelerated servers with H100 deliver the compute power along with 3 terabytes per second (TB/s) of memory bandwidth per GPU."},
    ]

    start = time.monotonic()
    try:
        rerank_result: AdapterResult = await adapter.invoke(
            model_def,
            [{"role": "user", "content": query}],
            query=query,
            passages=passages,
        )
        result.latency_ms = (time.monotonic() - start) * 1000
        result.params_used = model_def.source_parameters

        if rerank_result.success:
            result.status = "healthy"
            result.content = rerank_result.content[:500]
        else:
            result.error = rerank_result.error
            result.error_class = classify_error(rerank_result.error or "")
            result.status = "failed"

    except Exception as e:
        result.latency_ms = (time.monotonic() - start) * 1000
        result.error = str(e)
        result.error_class = classify_error(str(e))
        result.status = "error"

    return result


async def test_safety_model(
    model_def: ModelDefinition, api_key: str, base_url: str
) -> TestResult:
    result = TestResult(
        display_name=model_def.display_name,
        model_id=model_def.model_id,
        type=model_def.type.value,
        adapter=model_def.adapter,
        endpoint=model_def.endpoint.value,
        deprecated=model_def.deprecated_date is not None,
    )

    adapter_cls = ADAPTER_MAP.get(model_def.adapter)
    if not adapter_cls:
        result.status = "error"
        result.error = f"Unknown adapter: {model_def.adapter}"
        return result

    adapter = adapter_cls(api_key=api_key, base_url=base_url)

    safe_messages = [
        {"role": "user", "content": "How do I create a new project in Orbit CRM?"}
    ]

    start = time.monotonic()
    try:
        safe_result: AdapterResult = await adapter.invoke(model_def, safe_messages)
        result.latency_ms = (time.monotonic() - start) * 1000
        result.params_used = model_def.source_parameters

        if safe_result.success:
            result.status = "healthy"
            result.content = safe_result.content[:500]
            result.reasoning = safe_result.reasoning
            result.reasoning_detected = bool(safe_result.reasoning)
            result.safety_result = "safe_query_tested"
        else:
            result.error = safe_result.error
            result.error_class = classify_error(safe_result.error or "")
            result.status = "failed"

    except Exception as e:
        result.latency_ms = (time.monotonic() - start) * 1000
        result.error = str(e)
        result.error_class = classify_error(str(e))
        result.status = "error"

    return result


async def test_vlm_model(
    model_def: ModelDefinition, api_key: str, base_url: str
) -> TestResult:
    result = TestResult(
        display_name=model_def.display_name,
        model_id=model_def.model_id,
        type=model_def.type.value,
        adapter=model_def.adapter,
        endpoint=model_def.endpoint.value,
        deprecated=model_def.deprecated_date is not None,
    )

    model_id = model_def.source_parameters.get("model", model_def.model_id)

    if "paligemma" in model_id.lower():
        result.params_used = model_def.source_parameters
        adapter_cls = ADAPTER_MAP.get(model_def.adapter)
        if not adapter_cls:
            result.status = "error"
            result.error = f"Unknown adapter: {model_def.adapter}"
            return result

        adapter = adapter_cls(api_key=api_key, base_url=base_url)
        messages = [{"role": "user", "content": "Describe the image."}]

        start = time.monotonic()
        try:
            vlm_result: AdapterResult = await adapter.invoke(
                model_def, messages, prompt="Describe the image."
            )
            result.latency_ms = (time.monotonic() - start) * 1000

            if vlm_result.success:
                result.status = "healthy"
                result.content = vlm_result.content[:500]
            else:
                result.error = vlm_result.error
                result.error_class = classify_error(vlm_result.error or "")
                result.status = "failed"

        except Exception as e:
            result.latency_ms = (time.monotonic() - start) * 1000
            result.error = str(e)
            result.error_class = classify_error(str(e))
            result.status = "error"
    else:
        result.status = "test_blocked"
        result.error = "Nemotron-VL requires image input; text-only test not sufficient for vision capability"
        result.params_used = model_def.source_parameters

    return result


async def run_test(
    model_def: ModelDefinition, api_key: str, base_url: str, test_streaming: bool = False
) -> TestResult:
    if model_def.type == ModelType.EMBEDDING:
        return await test_embedding_model(model_def, api_key, base_url)
    elif model_def.type == ModelType.RERANK:
        return await test_rerank_model(model_def, api_key, base_url)
    elif model_def.type == ModelType.SAFETY:
        return await test_safety_model(model_def, api_key, base_url)
    elif model_def.type == ModelType.VLM:
        return await test_vlm_model(model_def, api_key, base_url)
    elif test_streaming and model_def.stream:
        return await test_streaming_model(model_def, api_key, base_url)
    else:
        return await test_chat_model(model_def, api_key, base_url)


def print_results_table(results: list[TestResult]) -> None:
    print("\n" + "=" * 120)
    print("FINAL RESULTS TABLE — ALL 29 NVIDIA MODELS")
    print("=" * 120)

    header = f"{'#':>2} {'Display Name':<35} {'Type':<10} {'HTTP':>5} {'Status':<15} {'Latency':>10} {'Stream':>6} {'Reasoning':>9} {'Error Class':<20}"
    print(header)
    print("-" * 120)

    for i, r in enumerate(results, 1):
        http_str = str(r.http_status) if r.http_status else "-"
        latency_str = f"{r.latency_ms:.0f}ms" if r.latency_ms else "-"
        stream_str = "Y" if r.streaming else "-"
        reasoning_str = "Y" if r.reasoning_detected else "-"
        error_str = r.error_class or "-"

        print(
            f"{i:>2} {r.display_name:<35} {r.type:<10} {http_str:>5} {r.status:<15} {latency_str:>10} {stream_str:>6} {reasoning_str:>9} {error_str:<20}"
        )

    print("-" * 120)

    healthy = sum(1 for r in results if r.status == "healthy")
    rate_limited = sum(1 for r in results if r.error_class == "rate_limited")
    deprecated_available = sum(
        1 for r in results if r.deprecated and r.status == "healthy"
    )
    retired = sum(
        1
        for r in results
        if r.deprecated and r.status in ("failed", "error") and r.error_class in ("model_not_found", "retired")
    )
    config_errors = sum(1 for r in results if r.error_class == "configuration_error")
    auth_errors = sum(1 for r in results if r.error_class == "auth_error")
    blocked = sum(1 for r in results if r.status == "test_blocked")
    failed = sum(
        1
        for r in results
        if r.status in ("failed", "error")
        and r.error_class not in ("rate_limited", "configuration_error", "auth_error", "model_not_found", "retired")
    )

    print(f"\nTOTAL = {len(results)}")
    print(f"HEALTHY = {healthy}")
    print(f"RATE LIMITED = {rate_limited}")
    print(f"DEPRECATED BUT AVAILABLE = {deprecated_available}")
    print(f"RETIRED = {retired}")
    print(f"CONFIG ERROR = {config_errors}")
    print(f"AUTH ERROR = {auth_errors}")
    print(f"BLOCKED (VLM no image) = {blocked}")
    print(f"OTHER FAILED = {failed}")


def main():
    parser = argparse.ArgumentParser(description="NVIDIA Model Live Test Runner")
    parser.add_argument("--all", action="store_true", help="Test all 29 models")
    parser.add_argument("--model", type=str, help="Test specific model by display_name")
    parser.add_argument("--type", type=str, help="Test models of specific type")
    parser.add_argument("--active-only", action="store_true", help="Only test active models")
    parser.add_argument("--include-deprecated", action="store_true", help="Include deprecated models")
    parser.add_argument("--streaming", action="store_true", help="Test streaming for stream=True models")
    parser.add_argument("--reasoning", action="store_true", help="Focus on reasoning/thinking models")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    args = parser.parse_args()

    api_key = os.getenv("NVIDIA_API_KEY")
    if not api_key:
        print("ERROR: NVIDIA_API_KEY not set in environment")
        sys.exit(1)

    base_url = os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")

    models_to_test: list[ModelDefinition] = []

    if args.model:
        model = nvidia_model_registry.get(args.model)
        if not model:
            model = nvidia_model_registry.get_by_model_id(args.model)
        if not model:
            print(f"ERROR: Model not found: {args.model}")
            sys.exit(1)
        models_to_test = [model]
    elif args.type:
        try:
            type_filter = ModelType(args.type)
        except ValueError:
            print(f"ERROR: Invalid type: {args.type}. Valid: {[t.value for t in ModelType]}")
            sys.exit(1)
        models_to_test = [m for m in NVIDIA_MODELS if m.type == type_filter]
    elif args.all or args.include_deprecated:
        models_to_test = list(NVIDIA_MODELS)
    elif args.active_only:
        models_to_test = nvidia_model_registry.list_active()
    else:
        models_to_test = nvidia_model_registry.list_active()

    if args.reasoning:
        models_to_test = [m for m in models_to_test if m.reasoning]

    print(f"Testing {len(models_to_test)} models...")
    print(f"API key: {'set' if api_key else 'NOT SET'}")
    print(f"Base URL: {base_url}")
    print()

    async def run_all():
        results: list[TestResult] = []
        concurrency = 2
        semaphore = asyncio.Semaphore(concurrency)

        async def run_with_semaphore(model_def):
            async with semaphore:
                return await run_test(model_def, api_key, base_url, args.streaming)

        tasks = [run_with_semaphore(m) for m in models_to_test]
        for i, coro in enumerate(asyncio.as_completed(tasks)):
            result = await coro
            results.append(result)
            status_icon = "OK" if result.status == "healthy" else "FAIL"
            print(f"  [{status_icon}] {result.display_name} -> {result.status} ({result.latency_ms:.0f}ms)")

        results.sort(key=lambda r: models_to_test.index(
            next(m for m in models_to_test if m.display_name == r.display_name)
        ))

        if args.json:
            print(json.dumps([asdict(r) for r in results], indent=2, default=str))
        else:
            print_results_table(results)

        return results

    results = asyncio.run(run_all())

    healthy = sum(1 for r in results if r.status == "healthy")
    print(f"\n{'='*60}")
    print(f"RESULT: {healthy}/{len(results)} models verified working.")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
