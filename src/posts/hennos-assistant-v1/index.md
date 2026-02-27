---
title: Building a Personal AI Assistant
date: 2026-02-14
description: Building a personal AI assistant with Telegram, OpenAI, and TypeScript.
---

Back in February 2023, I started building a Telegram chatbot as a side project. The idea was simple: wire up the OpenAI API to a Telegram bot so I could ask it questions from my phone. Three years later, that throwaway experiment has evolved into **Hennos**, a full-featured, multi-platform AI assistant with 18+ tools, five LLM providers, and a persistent memory system. It's open source at [repkam09/telegram-gpt-bot](https://github.com/repkam09/telegram-gpt-bot), and the live production instance is running at [t.me/repka_gpt_bot](https://t.me/repka_gpt_bot).

This post walks through how it got here, the architecture decisions, the features that stuck, and the code that makes it all work.

## How It Started

The very first commit on February 21, 2023 was a barebones Node.js script that took incoming Telegram messages, forwarded them to OpenAI's API, and sent the response back. It was maybe 100 lines of JavaScript.

By March I'd switched to the GPT-3.5 Turbo chat completions API, added basic group chat support so the bot could participate in Telegram group conversations, and started thinking about this as more than a toy. The single best early decision came in late April 2023: converting the entire codebase from JavaScript to TypeScript. At the time it seemed like unnecessary overhead for a side project, but given how much the project has grown since then, it was absolutely the right call.

Within the same week as the TypeScript conversion, I added voice message support. Users could send a voice memo to the bot, and it would be transcribed via OpenAI's Whisper API and processed as text. That handler is still surprisingly clean:

```typescript
export async function handleVoiceMessage(
  user: HennosUser,
  path: string,
): Promise<HennosResponse> {
  const provider = user.getProvider();

  try {
    const transcription = await provider.transcription(user, path);
    if (transcription.__type === "string") {
      const response = await handlePrivateMessage(user, transcription.payload, {
        role: "system",
        content:
          "The user sent their message via a voice recording. " +
          "The voice recording has been transcribed into text " +
          "for your convenience.",
        type: "text",
      });
      return response;
    }

    return transcription;
  } catch (err: unknown) {
    const error = err as Error;
    Logger.error(
      user,
      `Error processing voice message: ${error.message}`,
      error,
    );
    return {
      __type: "error",
      payload: "Sorry, I was unable to process your voice message.",
    };
  }
}
```

The pattern of transcribe the input, inject a system hint about the input type, then pass it through the same text handler became a recurring design pattern. Voice, images, documents, and forwarded messages all funnel through a common pipeline, with small system hints giving the LLM context about what kind of input it's dealing with.

## The Multi-Provider Architecture

One of the most important architectural decisions was abstracting away the LLM provider. Early on, Hennos was hardcoded to OpenAI. Then in late 2023 I added Ollama support so non-whitelisted users could still interact with the bot using local models without running up API costs. After that came Anthropic, Google Gemini, and most recently AWS Bedrock.

Every provider implements a common abstract base class:

```typescript
export abstract class HennosBaseProvider {
  public client: unknown;
  public tokenLimit: number = 0;

  public abstract invoke(
    req: HennosConsumer,
    messages: HennosTextMessage[],
    schema?: boolean,
  ): Promise<HennosStringResponse>;

  public abstract completion(
    req: HennosConsumer,
    system: HennosTextMessage[],
    complete: HennosMessage[],
  ): Promise<HennosResponse>;

  public abstract moderation(
    req: HennosConsumer,
    input: string,
  ): Promise<boolean>;
  public abstract transcription(
    req: HennosConsumer,
    path: string,
  ): Promise<HennosResponse>;
  public abstract speech(
    req: HennosConsumer,
    input: string,
  ): Promise<HennosResponse>;
  public abstract details(): string;
}
```

This means all the handler code, tool-calling logic, and prompt construction don't care which model is actually running underneath. A user's provider selection is stored in the database and resolved at request time:

```typescript
public getProvider(): HennosBaseProvider {
    if (this.whitelisted) {
        switch (this.provider) {
            case "openai":
                return HennosOpenAISingleton.instance();
            case "ollama":
                return HennosOllamaSingleton.instance();
            case "anthropic":
                return HennosAnthropicSingleton.instance();
            case "bedrock":
                return HennosBedrockSingleton.instance();
            default:
                Logger.warn(this, `Unknown provider ${this.provider}, defaulting to OpenAI`);
                return HennosOpenAISingleton.instance();
        }
    }
    return HennosOpenAISingleton.mini();
}
```

Non-whitelisted users are routed to a smaller "mini" model for cost control. Whitelisted users can switch between providers using a `/settings` command in Telegram. This was essential as the LLM landscape changed so rapidly that being able to swap from GPT-4 to Claude to Llama 3 without changing any application logic kept the project from getting locked into any single vendor.

## The Permission System

Hennos has a tiered permission model that governs what each user can do. At its core, the system distinguishes between three levels: non-whitelisted users, whitelisted users, and admins.

Non-whitelisted users get a constrained experience. They can chat with the bot, but their messages are run through OpenAI's moderation endpoint first, they don't get persistent conversation history, and they only have access to a handful of basic tools. This was important for keeping the bot accessible without letting strangers rack up API costs or abuse the system:

```typescript
async function handleLimitedUserPrivateMessage(
  user: HennosUser,
  text: string,
  context: boolean,
  hint?: HennosTextMessage,
): Promise<HennosResponse> {
  const prompt: HennosTextMessage[] = await hennosBasePrompt(user);
  const provider = user.getProvider();

  const flagged = await provider.moderation(user, text);
  if (flagged) {
    return {
      __type: "error",
      payload:
        "Sorry, I can't help with that. " +
        "Your message appears to violate the moderation rules.",
    };
  }

  const response = await provider.completion(user, prompt, [
    { content: text, role: "user", type: "text" },
  ]);

  return response;
}
```

Whitelisted users get the full experience: persistent chat history, tool calling, image/voice processing, and the ability to configure their preferred LLM provider. Admins get everything plus access to more powerful tools like Home Assistant smart home control.

## The Tools System

Tool calling is where Hennos really started to feel like an assistant rather than a chatbot. The system currently has 18+ tools, organized into permission tiers so they can be selectively exposed based on the user's access level:

```typescript
const PUBLIC_TOOLS = [
  SearXNGSearch,
  MetaFeedbackTool,
  MetaFeatureRequest,
  MetaBugReport,
];

const WHITELIST_TOOLS = [
  FetchWebpageContent,
  PerplexitySearch,
  OpenWeatherMapLookupTool,
  WolframAlpha,
  PythonSandbox,
  AcknowledgeWithoutResponse,
  ImageGenerationTool,
  CreateArtifact,
  SendImageFromURL,
  BraveSearch,
  MetaSetBotPreferredName,
  MetaSetUserPreferredName,
  MetaSetLLMProvider,
];

const EXPERIMENTAL_AVAILABLE_TOOLS = [
  JellyseerMediaRequest,
  JellyseerMediaSearch,
  AudiobookRequest,
  EbookRequest,
];

const ADMIN_TOOLS = [
  HomeAssistantEntitiesTool,
  HomeAssistantStatesTool,
  HennosRetrieveArtifact,
];
```

Every tool extends a `BaseTool` abstract class and implements three static methods: `isEnabled()` (checks if the required API keys/config exist), `definition()` (returns the OpenAI-compatible function definition), and `callback()` (executes the tool and returns a result). Here's the weather tool as a representative example:

```typescript
export class OpenWeatherMapLookupTool extends BaseTool {
  public static isEnabled(): boolean {
    if (Config.OPEN_WEATHER_API) {
      return true;
    }
    return false;
  }

  public static definition(): Tool {
    return {
      type: "function",
      function: {
        name: "open_weather_map_lookup",
        description:
          "This tool utilizes the Open Weather Map API " +
          "to provide weather reports for specific locations. " +
          "To use this tool, you must supply the latitude and longitude " +
          "coordinates of the desired location.",
        parameters: {
          type: "object",
          properties: {
            mode: {
              type: "string",
              description:
                "Choose 'current' for present conditions " +
                "or 'forecast' for future predictions.",
            },
            lat: {
              type: "number",
              description: "Latitude of the location.",
            },
            lon: {
              type: "number",
              description: "Longitude of the location.",
            },
            units: {
              type: "string",
              description: "Available options are 'metric' or 'imperial'.",
            },
          },
          required: ["lat", "lon"],
        },
      },
    };
  }

  public static async callback(
    req: HennosConsumer,
    args: ToolCallFunctionArgs,
    metadata: ToolCallMetadata,
  ): Promise<ToolCallResponse> {
    const units = args.units ?? "metric";
    const mode = args.mode ?? "current";

    try {
      const url = `https://api.openweathermap.org/data/2.5/${
        mode === "forecast" ? "forecast" : "weather"
      }?lat=${args.lat}&lon=${args.lon}&units=${units}&appid=${Config.OPEN_WEATHER_API}`;

      const weather = await BaseTool.fetchJSONData(url);
      return [
        `Weather report for lat=${args.lat} lon=${args.lon}: ${JSON.stringify(weather)}`,
        metadata,
      ];
    } catch (err: unknown) {
      const error = err as Error;
      Logger.error(req, `open_weathermap_lookup_tool_callback error.`, error);
      return [`open_weather_map_lookup error`, metadata];
    }
  }
}
```

This pattern scales well. Adding a new tool means creating a single file, implementing the three methods, and adding it to the appropriate tier array. The tool results are passed back into the LLM as context, and the system supports recursive tool calls, the LLM can chain up to 8 tool invocations per request (configurable via `HENNOS_TOOL_DEPTH`) to reason through multi-step problems. For example, it might look up the user's location from the database, call the weather API, then format a natural language response.

The full range of tools covers quite a bit of ground:

- **Web search** via Brave Search, SearXNG, and Perplexity AI
- **Knowledge lookups** via Wolfram Alpha and web page fetching
- **Weather** via OpenWeatherMap
- **Smart home** via Home Assistant (admin-only)
- **Media requests** via Jellyseer for movie/TV show requests to a Jellyfin server
- **Image generation** via DALL-E, ComfyUI with Flux, and Gemini
- **Code execution** via a Python sandbox (Terrarium)
- **Utility tools** for user feedback, artifact creation, and bot customization

## Conversation Memory

One of the key differences between a chatbot and an assistant is memory. Hennos stores all conversation history in SQLite via Prisma, so whitelisted users get persistent context across sessions. When I message it on Monday about a project, it still has that context on Wednesday.

The system prompt is constructed dynamically for each request, incorporating the user's preferences, location, whitelist status, and how long it's been since they last messaged:

```typescript
export async function hennosBasePrompt(
  req: HennosConsumer,
): Promise<HennosTextMessage[]> {
  let botName = Config.HENNOS_BOT_NAME;
  let preferredName = req.displayName;

  if (req instanceof HennosUser) {
    const preferences = await req.getPreferences();
    if (preferences.botName) {
      botName = preferences.botName;
    }
    if (preferences.preferredName) {
      preferredName = preferences.preferredName;
    }
  }

  const prompt: HennosTextMessage[] = minimalBasePrompt(botName);

  prompt.push({
    role: "system",
    content:
      "In order to provide the best possible assistance you should " +
      "make use of various tool calls to gather additional information, " +
      "to verify information you have in your training data, and to make " +
      "sure you provide the most accurate and up-to-date information.",
    type: "text",
  });

  // ... user-specific context like name, location, permissions, last active time
  return prompt;
}
```

The prompt also includes temporal grounding, the current date and day of the week, so the model can answer time-sensitive questions accurately. The `lastActive()` method tracks how long it's been since the last message, giving the LLM context about whether this is a continuation of a recent conversation or a fresh interaction after hours or days.

## The Telegram Integration

The Telegram service is by far the most developed integration. It handles text, voice, photos, documents, audio files, stickers, locations, contacts, forwarded messages, reply context, group chats, callback queries for inline settings, and even emoji reactions as typing indicators.

One neat feature is the message batching for private chats. If a user sends multiple messages in quick succession (common on mobile), the bot waits 2 seconds after the last message before processing them all as one combined input:

```typescript
async function handleTelegramPrivateMessage(
  user: HennosUser,
  msg: MessageWithText,
) {
  // Reset the time between messages timer
  clearTimeout(PendingChatTimerMap.get(user.chatId));

  const current = PendingChatMap.get(user.chatId) || [];
  const cleaned = replaceTelegramBotName(msg.text, "Hennos", "ig");
  current.push(cleaned);
  PendingChatMap.set(user.chatId, current);

  // Set the timer to process the messages if we don't get any more within 2 seconds
  const timeout = setTimeout(async () => {
    PendingChatTimerMap.delete(user.chatId);
    const messages = PendingChatMap.get(user.chatId);
    PendingChatMap.delete(user.chatId);
    if (!messages) return;

    TelegramBotInstance.setTelegramIndicator(user, "typing");
    const response = await handlePrivateMessage(
      user,
      messages.length === 1 ? messages[0] : messages.join("\n"),
    );
    return handleHennosResponse(user, response, {});
  }, 2000);

  PendingChatTimerMap.set(user.chatId, timeout);
}
```

The bot also handles Markdown formatting gracefully. It attempts to send messages with Markdown parse mode first, and falls back to plain text if Telegram's Markdown parser rejects it. And long messages over 4000 characters get automatically chunked into multiple messages.

For group chats, the bot only responds when explicitly mentioned via @. But if `TELEGRAM_GROUP_CONTEXT` is enabled, it silently ingests all group messages into the conversation context, so when someone does @ it, the bot has full awareness of the recent conversation. Each message is tagged with the sender's display name so the LLM can track who said what in a multi-user conversation.

## Beyond Telegram

While Telegram is the primary interface, Hennos also supports Discord with basic text and experimental voice channel integration, and Twitch chat. All platforms share the same core LLM logic, tool system, and permission model. There's even a CLI interface for local development and testing without any messaging platform involved.

The entrypoint of the application initializes whichever services are enabled via environment flags:

```typescript
async function start() {
  Logger.info(undefined, "Starting Hennos bot...");

  await Database.init();

  const init = [];
  if (Config.TELEGRAM_ENABLED) {
    init.push(TelegramBotInstance.init());
  }
  if (Config.DISCORD_ENABLED) {
    init.push(DiscordBotInstance.init());
  }

  init.push(LifeforceBroadcast.init());
  await Promise.all(init);

  // In dev mode with no providers enabled, run the CLI
  const enabled = [Config.TELEGRAM_ENABLED, Config.DISCORD_ENABLED /* ... */];
  if (Config.HENNOS_DEVELOPMENT_MODE && !enabled.includes(true)) {
    await CommandLineInstance.run();
  }
}
```

## Infrastructure and Deployment

Hennos runs in Docker with `docker-compose`, making deployment a single command. The stack includes SQLite via Prisma for all persistent data, with optional Qdrant for vector embeddings. A Caddy reverse proxy handles HTTPS termination for the Telegram webhook mode, which provides lower latency than the default polling approach.

Everything is configured through environment variables. Every API key, every feature toggle, every model selection. This makes it straightforward to run different configurations for development vs. production, or to spin up a version with only local Ollama models and no external API dependencies at all.

## Lessons Learned

Building Hennos over the past three years has taught me a few things worth sharing:

**Use the thing you build.** Hennos is my daily driver. I use it for quick questions, weather checks, smart home control, media requests, and random curiosity throughout the day. That constant usage surfaces bugs and missing features faster than any test suite. Every tool I've added exists because I found myself reaching for it and it wasn't there yet.

**TypeScript was the right call early on.** Converting from JavaScript to TypeScript in the first two months felt like over-engineering a toy project. But refactoring a system with 18 tools, 5 LLM providers, and platform-specific handlers across Telegram, Discord, and Twitch would be genuinely painful without type safety. The early investment paid for itself many times over.

**Provider abstraction was essential.** The LLM landscape has moved so fast that being locked into a single provider would have been a constant source of friction. The abstract `HennosBaseProvider` class means I can adopt a new model the day it launches by implementing a single adapter, while all the tools, prompts, and handlers continue to work unchanged.

**Tool calling is the line between chatbot and assistant.** The moment Hennos could look up weather, search the web, and control my smart home, it stopped being a novelty and started being genuinely useful. The difference isn't intelligence, it's the ability to take actions in the real world.

**Start simple, ship it, iterate.** The first version was a few dozen lines of JavaScript. Three years later it's a multi-platform system with persistent memory, tool calling, and image generation. But every step along the way was small, incremental, and immediately usable. I never sat down to "build an AI assistant platform." I just kept making the thing I was already using a little bit better, one commit at a time.

## What's Next

There's a lot more to talk about! I've been working on an agentic workflow system using Temporalio that fundamentally changes how Hennos handles complex multi-step tasks. That's a big enough topic for its own post, so stay tuned for a follow-up where I dig into the `temporal-worker` branch (which will hopefully be merged soon) and the architecture behind agentic AI assistant workflows.
