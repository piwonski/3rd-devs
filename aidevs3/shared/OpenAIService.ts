import { OpenAI, toFile } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import Groq from "groq-sdk";
import { Environment } from "./Environment";
import fs from "fs";

export class OpenAIService {
  private openai: OpenAI;
  private groq: Groq;

  constructor() {
    this.openai = new OpenAI();
    this.groq = new Groq({
      apiKey: Environment.getGroqApiKey()
    });
  }

  async completion(config: {
    messages: ChatCompletionMessageParam[],
    model?: string,
    stream?: boolean,
    jsonMode?: boolean
  }): Promise<OpenAI.Chat.Completions.ChatCompletion | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    const { messages, model = "gpt-4o", stream = false, jsonMode = false } = config;
    try {
      const chatCompletion = await this.openai.chat.completions.create({
        messages,
        model,
        stream,
        response_format: jsonMode ? { type: "json_object" } : { type: "text" }
      });

      if (stream) {
        return chatCompletion as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
      } else {
        return chatCompletion as OpenAI.Chat.Completions.ChatCompletion;
      }
    } catch (error) {
      console.error("Error in OpenAI completion:", error);
      throw error;
    }
  }

  async transcribeGroq(audioBuffer: Buffer): Promise<string> {
    const transcription = await this.groq.audio.transcriptions.create({
      file: await toFile(audioBuffer, 'speech.mp3'),
      language: 'pl',
      model: 'whisper-large-v3',
    });
    return transcription.text;
  }

  async generateImage(prompt: string): Promise<string> {
    console.log("Generating image...");
    try {
      const response = await this.openai.images.generate({
        model: "dall-e-3",
        prompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
        style: "natural"
      });

      if (!response.data) {
        throw new Error("No data in response");
      }

      console.log("Image Generation Response:", {
        created: response.created,
        data: response.data.map(img => ({
          url: img.url,
          revised_prompt: img.revised_prompt
        }))
      });

      if (!response.data[0]?.url) {
        throw new Error("No image URL in response");
      }

      return response.data[0].url;
    } catch (error) {
      console.error("Error generating image:", error);
      throw error;
    }
  }

  async processImage(imagePath: string, prompt: string): Promise<{ description: string; source: string }> {
    try {
      const image = await fs.promises.readFile(imagePath);
      const base64Image = image.toString('base64');

      const messages: ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          ],
        },
      ];

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages,
      });

      return {
        description: response.choices[0].message.content || "No description available.",
        source: imagePath,
      };
    } catch (error) {
      console.error(`Error processing image ${imagePath}:`, error);
      throw error;
    }
  }
}

