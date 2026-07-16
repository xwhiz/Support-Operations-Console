/**
 * LLM provider adapter. This is the ONLY file that imports the Gemini SDK; the
 * rest of the agent talks to the provider-neutral `LlmClient` interface, so
 * swapping providers (or injecting a mock in tests) is a one-file change.
 */
import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { config } from "../config";

export type ToolCall = {
  id?: string;
  name: string;
  args: Record<string, unknown>;
  /** Gemini 3+ returns an opaque thought signature on function-call parts that
   *  MUST be echoed back on the next turn or tool calling degrades/errors. */
  thoughtSignature?: string;
};

export type NeutralContent =
  | { role: "user"; text: string }
  | { role: "model"; text?: string; toolCalls?: ToolCall[] }
  | {
      role: "tool";
      responses: { id?: string; name: string; response: Record<string, unknown> }[];
    };

export type ToolDef = {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
};

export type GenerateResult = {
  text: string;
  toolCalls: ToolCall[];
  usage: { input?: number; output?: number };
};

export interface LlmClient {
  generate(args: {
    system: string;
    contents: NeutralContent[];
    tools: ToolDef[];
  }): Promise<GenerateResult>;
}

function toGeminiContents(contents: NeutralContent[]): Content[] {
  return contents.map((c): Content => {
    if (c.role === "user") {
      return { role: "user", parts: [{ text: c.text }] };
    }
    if (c.role === "model") {
      const parts: Part[] = [];
      if (c.text) parts.push({ text: c.text });
      for (const tc of c.toolCalls ?? []) {
        parts.push({
          functionCall: { id: tc.id, name: tc.name, args: tc.args },
          thoughtSignature: tc.thoughtSignature,
        });
      }
      return { role: "model", parts };
    }
    // Function responses are "spoken" by the user role (per Gemini contract).
    return {
      role: "user",
      parts: c.responses.map(
        (r): Part => ({
          functionResponse: { id: r.id, name: r.name, response: r.response },
        }),
      ),
    };
  });
}

export function createGeminiClient(): LlmClient {
  const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  return {
    async generate({ system, contents, tools }) {
      const res = await ai.models.generateContent({
        model: config.GEMINI_MODEL,
        contents: toGeminiContents(contents),
        config: {
          systemInstruction: system,
          temperature: 0,
          // Only send a tools block when there are tools — an empty
          // functionDeclarations array is rejected, and compose calls pass none.
          ...(tools.length > 0
            ? {
                tools: [
                  {
                    functionDeclarations: tools.map((t) => ({
                      name: t.name,
                      description: t.description,
                      parametersJsonSchema: t.parametersJsonSchema,
                    })),
                  },
                ],
              }
            : {}),
        },
      });

      // Read raw parts (not the functionCalls accessor) so we can capture the
      // per-part thoughtSignature and echo it back on the next turn.
      const modelParts = res.candidates?.[0]?.content?.parts ?? [];
      const toolCalls: ToolCall[] = [];
      for (const part of modelParts) {
        if (part.functionCall) {
          toolCalls.push({
            id: part.functionCall.id,
            name: part.functionCall.name ?? "",
            args: (part.functionCall.args ?? {}) as Record<string, unknown>,
            thoughtSignature: part.thoughtSignature,
          });
        }
      }

      return {
        text: res.text ?? "",
        toolCalls,
        usage: {
          input: res.usageMetadata?.promptTokenCount,
          output: res.usageMetadata?.candidatesTokenCount,
        },
      };
    },
  };
}
