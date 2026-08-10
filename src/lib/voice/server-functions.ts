import { createServerFn } from "@tanstack/react-start";
import { getSupabaseClient } from "@/lib/supabase/client";
import { processVoiceNote } from "./processor";
import { learnFromCorrection, saveProjectMapping, getMemoryForIntent } from "./memory";
import { executeIntent } from "./intent-router";

export const processVoiceNoteFn = createServerFn({ method: "POST" }).handler(
  async ({ request }) => {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      return new Response(JSON.stringify({ error: "No audio file provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = getSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let userId: string | undefined;
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", user.id)
        .single();
      if (profile) {
        userId = user.id;
      }
    }

    try {
      const audioBlob = audioFile.slice(0, audioFile.size, audioFile.type);
      const result = await processVoiceNote(audioBlob, userId);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Voice processing error:", error);
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Processing failed" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
);

export const aiLearnFn = createServerFn({ method: "POST" }).handler(async ({ request }) => {
  const body = await request.json();
  const { originalPhrase, correctedValue, entityType, projectId, projectName } = body;

  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check if user exists in profiles table
  const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).single();

  if (!profile) {
    return new Response(JSON.stringify({ error: "No profile found" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await learnFromCorrection(user.id, originalPhrase, correctedValue, entityType);

    if (projectId && projectName) {
      await saveProjectMapping(user.id, projectName, projectId);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("AI learn error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Learning failed" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});

export const getAiMemoryFn = createServerFn({ method: "POST" }).handler(async ({ request }) => {
  const body = await request.json();
  const { transcript } = body;

  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).single();

  if (!profile) {
    return new Response(JSON.stringify({ memory: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const memory = await getMemoryForIntent(user.id, transcript);

  return new Response(JSON.stringify({ memory }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

export const executeIntentFn = createServerFn({ method: "POST" }).handler(async ({ request }) => {
  const body = await request.json();
  const { intent } = body;

  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).single();

  if (!profile) {
    return new Response(JSON.stringify({ error: "No profile found" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await executeIntent(user.id, intent);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Intent execution error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Execution failed" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
