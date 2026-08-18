"""
AI Router - Multi-model routing service
Routes tasks to optimal AI models based on task type and capabilities
"""

import logging
from typing import Optional
from enum import Enum

from backend.services.nvidia_model_registry import (
    nvidia_model_registry,
    ModelType as NVIDIAModelType,
    ModelDefinition,
)

logger = logging.getLogger(__name__)


class TaskType(str, Enum):
    CODING = "coding"
    WRITING = "writing"
    SEO = "seo"
    ANALYSIS = "analysis"
    REASONING = "reasoning"
    TRANSLATION = "translation"
    DATA_PROCESSING = "data_processing"


class ModelProvider(str, Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    NVIDIA = "nvidia"
    DEEPSEEK = "deepseek"
    YANDEX = "yandex"
    OLLAMA = "ollama"


class ModelConfig:
    def __init__(
        self,
        model_id: str,
        provider: ModelProvider,
        strengths: list[TaskType],
        cost_tier: int,  # 1=low, 2=medium, 3=high
        max_tokens: int = 4096,
        supports_streaming: bool = True,
    ):
        self.model_id = model_id
        self.provider = provider
        self.strengths = strengths
        self.cost_tier = cost_tier
        self.max_tokens = max_tokens
        self.supports_streaming = supports_streaming


# Available models configuration
AVAILABLE_MODELS = [
    ModelConfig(
        model_id="openai/gpt-4o",
        provider=ModelProvider.OPENAI,
        strengths=[TaskType.CODING, TaskType.REASONING, TaskType.ANALYSIS],
        cost_tier=3,
        max_tokens=128000,
    ),
    ModelConfig(
        model_id="openai/gpt-4o-mini",
        provider=ModelProvider.OPENAI,
        strengths=[TaskType.WRITING, TaskType.TRANSLATION, TaskType.SEO],
        cost_tier=1,
        max_tokens=128000,
    ),
    ModelConfig(
        model_id="anthropic/claude-3.5-sonnet",
        provider=ModelProvider.ANTHROPIC,
        strengths=[TaskType.CODING, TaskType.WRITING, TaskType.ANALYSIS],
        cost_tier=3,
        max_tokens=200000,
    ),
    ModelConfig(
        model_id="nvidia/llama-3.3-70b-instruct",
        provider=ModelProvider.NVIDIA,
        strengths=[TaskType.REASONING, TaskType.ANALYSIS],
        cost_tier=2,
        max_tokens=128000,
    ),
    ModelConfig(
        model_id="deepseek/deepseek-coder",
        provider=ModelProvider.DEEPSEEK,
        strengths=[TaskType.CODING],
        cost_tier=1,
        max_tokens=128000,
    ),
    ModelConfig(
        model_id="yandex/yandexgpt",
        provider=ModelProvider.YANDEX,
        strengths=[TaskType.WRITING, TaskType.SEO, TaskType.TRANSLATION],
        cost_tier=1,
        max_tokens=8192,
    ),
]

# ---------------------------------------------------------------------------
# NVIDIA models from registry — active models only, mapped to TaskType strengths
# ---------------------------------------------------------------------------

_NVIDIA_TASK_MAP: dict[str, list[TaskType]] = {
    "google/gemma-4-31b-it": [TaskType.REASONING, TaskType.ANALYSIS],
    "z-ai/glm-5.2": [TaskType.WRITING, TaskType.TRANSLATION],
    "openai/gpt-oss-120b": [TaskType.CODING, TaskType.REASONING, TaskType.ANALYSIS],
    "openai/gpt-oss-20b": [TaskType.CODING, TaskType.REASONING],
    "poolside/laguna-xs-2.1": [TaskType.CODING],
    "nvidia/nemotron-3.5-lightning-30b-a3b": [TaskType.REASONING, TaskType.ANALYSIS],
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": [TaskType.REASONING, TaskType.ANALYSIS],
    "nvidia/nemotron-3-super-120b-a12b": [TaskType.REASONING, TaskType.CODING, TaskType.ANALYSIS],
    "nvidia/nemotron-3-ultra-550b-a55b": [TaskType.REASONING, TaskType.CODING, TaskType.ANALYSIS],
    "minimaxai/minimax-m3": [TaskType.WRITING, TaskType.TRANSLATION],
    "mistralai/mistral-nemotron": [TaskType.CODING, TaskType.REASONING],
    "meta/muse-glimmer-30b": [TaskType.WRITING, TaskType.ANALYSIS],
    "nvidia/nemotron-mini-4b-instruct": [TaskType.WRITING, TaskType.TRANSLATION],
    "nvidia/nvidia-nemotron-nano-9b-v2": [TaskType.REASONING],
}

_NVIDIA_COST_MAP: dict[str, int] = {
    "google/gemma-4-31b-it": 2,
    "z-ai/glm-5.2": 2,
    "openai/gpt-oss-120b": 3,
    "openai/gpt-oss-20b": 2,
    "poolside/laguna-xs-2.1": 1,
    "nvidia/nemotron-3.5-lightning-30b-a3b": 2,
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": 2,
    "nvidia/nemotron-3-super-120b-a12b": 3,
    "nvidia/nemotron-3-ultra-550b-a55b": 3,
    "minimaxai/minimax-m3": 2,
    "mistralai/mistral-nemotron": 2,
    "meta/muse-glimmer-30b": 1,
    "nvidia/nemotron-mini-4b-instruct": 1,
    "nvidia/nvidia-nemotron-nano-9b-v2": 1,
}


def _build_nvidia_models() -> list[ModelConfig]:
    """Build ModelConfig entries from the NVIDIA registry for active chat models."""
    configs: list[ModelConfig] = []
    for model_def in nvidia_model_registry.list_active():
        if model_def.type not in (NVIDIAModelType.CHAT, NVIDIAModelType.VLM):
            continue
        strengths = _NVIDIA_TASK_MAP.get(model_def.model_id, [TaskType.REASONING])
        cost_tier = _NVIDIA_COST_MAP.get(model_def.model_id, 2)
        configs.append(
            ModelConfig(
                model_id=model_def.model_id,
                provider=ModelProvider.NVIDIA,
                strengths=strengths,
                cost_tier=cost_tier,
                max_tokens=model_def.source_parameters.get("max_tokens", 4096),
                supports_streaming=model_def.stream or True,
            )
        )
    return configs


AVAILABLE_MODELS.extend(_build_nvidia_models())


# Task type keywords for classification
TASK_TYPE_KEYWORDS: dict[TaskType, list[str]] = {
    TaskType.CODING: [
        "код", "code", "api", "backend", "frontend", "function",
        "component", "endpoint", "database", "sql", "migrate",
        "debug", "fix bug", "refactor", "typescript", "python",
    ],
    TaskType.WRITING: [
        "текст", "статья", "copywriting", "content", "blog",
        "описание", "description", "пост", "article", "newsletter",
    ],
    TaskType.SEO: [
        "seo", "семантика", "мета", "meta", "keywords", "ключев",
        "оптимизация", "position", "rank", " SERP",
    ],
    TaskType.ANALYSIS: [
        "анализ", "analysis", "отчет", "report", "метрики", "metrics",
        "дашборд", "dashboard", "kpi", "статистика", "statistics",
    ],
    TaskType.REASONING: [
        "стратегия", "strategy", "план", "plan", "архитектура",
        "architecture", "дизайн", "design", "решение", "solution",
    ],
    TaskType.TRANSLATION: [
        "перевод", "translate", "локализация", "localization",
        "l10n", "i18n",
    ],
    TaskType.DATA_PROCESSING: [
        "данные", "data", "парсинг", "scraping", "ETL",
        "импорт", "import", "экспорт", "export",
    ],
}


class AIRouter:
    """
    Multi-model AI router that selects optimal model for each task.
    
    Usage:
        router = AIRouter()
        model = await router.route_task(task_title, task_description)
        # Use model to generate response
    """

    def __init__(self, preferred_models: Optional[list[str]] = None):
        self.preferred_models = preferred_models or []
        self._model_availability: dict[str, bool] = {
            m.model_id: True for m in AVAILABLE_MODELS
        }

    def classify_task_type(self, title: str, description: str = "") -> TaskType:
        """
        Classify task type based on title and description.
        
        Args:
            title: Task title
            description: Task description
            
        Returns:
            Classified TaskType
        """
        text = f"{title} {description}".lower()
        
        # Score each task type based on keyword matches
        scores: dict[TaskType, int] = {}
        for task_type, keywords in TASK_TYPE_KEYWORDS.items():
            score = sum(1 for kw in keywords if kw in text)
            if score > 0:
                scores[task_type] = score
        
        if not scores:
            return TaskType.REASONING  # Default to reasoning
        
        # Return the type with highest score
        return max(scores, key=scores.get)

    def select_model(
        self,
        task_type: TaskType,
        prefer_cost_efficient: bool = True,
    ) -> Optional[ModelConfig]:
        """
        Select optimal model for task type.
        
        Args:
            task_type: Type of task
            prefer_cost_efficient: If True, prefer cheaper models
            
        Returns:
            Selected ModelConfig or None if no models available
        """
        # Filter models that support this task type
        suitable_models = [
            m for m in AVAILABLE_MODELS
            if task_type in m.strengths and self._model_availability.get(m.model_id, False)
        ]
        
        if not suitable_models:
            # Fallback to any available model
            suitable_models = [
                m for m in AVAILABLE_MODELS
                if self._model_availability.get(m.model_id, False)
            ]
        
        if not suitable_models:
            return None
        
        # Check preferred models first
        if self.preferred_models:
            for preferred_id in self.preferred_models:
                for model in suitable_models:
                    if model.model_id == preferred_id:
                        return model
        
        # Sort by cost (if prefer_cost_efficient) or by capability
        if prefer_cost_efficient:
            suitable_models.sort(key=lambda m: m.cost_tier)
        else:
            # Prefer more capable models (higher cost tier)
            suitable_models.sort(key=lambda m: -m.cost_tier)
        
        return suitable_models[0] if suitable_models else None

    async def route_task(
        self,
        title: str,
        description: str = "",
        prefer_cost_efficient: bool = True,
    ) -> dict:
        """
        Route task to optimal model.
        
        Args:
            title: Task title
            description: Task description
            prefer_cost_efficient: Prefer cost-efficient models
            
        Returns:
            Dict with model_id, task_type, provider info
        """
        task_type = self.classify_task_type(title, description)
        model = self.select_model(task_type, prefer_cost_efficient)
        
        if not model:
            logger.warning(f"No suitable model found for task type: {task_type}")
            return {
                "model_id": None,
                "task_type": task_type.value,
                "provider": None,
                "error": "No available models",
            }
        
        return {
            "model_id": model.model_id,
            "task_type": task_type.value,
            "provider": model.provider.value,
            "cost_tier": model.cost_tier,
            "max_tokens": model.max_tokens,
        }

    def mark_model_unavailable(self, model_id: str) -> None:
        """Mark model as unavailable (e.g., rate limited)"""
        self._model_availability[model_id] = False
        logger.info(f"Model {model_id} marked as unavailable")

    def mark_model_available(self, model_id: str) -> None:
        """Mark model as available"""
        self._model_availability[model_id] = True
        logger.info(f"Model {model_id} marked as available")

    def get_available_models(self) -> list[dict]:
        """Get list of available models"""
        return [
            {
                "model_id": m.model_id,
                "provider": m.provider.value,
                "strengths": [s.value for s in m.strengths],
                "cost_tier": m.cost_tier,
                "available": self._model_availability.get(m.model_id, False),
            }
            for m in AVAILABLE_MODELS
        ]


# Global router instance
ai_router = AIRouter()