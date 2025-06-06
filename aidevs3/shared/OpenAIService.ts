import { OpenAI, toFile } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import Groq from "groq-sdk";
import { Environment } from "./Environment";
import { ExpenseCounter } from "./ExpenseCounter";
import fs from "fs";
import type {CreateEmbeddingResponse} from "openai/resources/embeddings";

export class OpenAIService {
  private openai: OpenAI;
  private groq: Groq;
  private embeddingDimensions: number;
  private expenseCounter?: ExpenseCounter;

  constructor(embeddingDimensions: number = 3072, expenseCounter?: ExpenseCounter) {
    this.openai = new OpenAI();
    this.groq = new Groq({
      apiKey: Environment.getGroqApiKey()
    });
    this.embeddingDimensions = embeddingDimensions;
    this.expenseCounter = expenseCounter;
  }

  async completion(config: {
    messages: ChatCompletionMessageParam[],
    model?: string,
    stream?: boolean,
    jsonMode?: boolean
  }): Promise<OpenAI.Chat.Completions.ChatCompletion | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    const { messages, model = "gpt-4.1", stream = false, jsonMode = false } = config;
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
        const completion = chatCompletion as OpenAI.Chat.Completions.ChatCompletion;
        // Track costs automatically
        this.expenseCounter?.increaseCost(completion);
        return completion;
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
        model: "gpt-4.1",
        messages,
      });

      // Track costs automatically
      this.expenseCounter?.increaseCost(response);

      return {
        description: response.choices[0].message.content || "No description available.",
        source: imagePath,
      };
    } catch (error) {
      console.error(`Error processing image ${imagePath}:`, error);
      throw error;
    }
  }

  async processImageWithPrompt(base64Image: string, prompt: string, imageName: string): Promise<{ name: string; preview: string }> {
    try {
      const messages: ChatCompletionMessageParam[] = [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
            { type: "text", text: prompt }
          ],
        },
      ];

      const response = await this.openai.chat.completions.create({
        model: "gpt-4.1",
        messages,
        response_format: { type: "json_object" }
      });

      // Track costs automatically
      this.expenseCounter?.increaseCost(response);
      
      if (this.expenseCounter) {
        console.log('💰 Vision API call completed - tokens used:', {
          input: response.usage?.prompt_tokens || 0,
          output: response.usage?.completion_tokens || 0,
          total: response.usage?.total_tokens || 0
        });
      }

      try {
        const result = JSON.parse(response.choices[0].message.content || '{}');
        return {
          name: imageName,
          preview: result.preview || ''
        };
      } catch (parseError) {
        console.error('Error parsing JSON response:', parseError);
        // Fallback to using the raw content if JSON parsing fails
        return {
          name: imageName,
          preview: response.choices[0].message.content || ''
        };
      }
    } catch (error) {
      console.error('Error processing image:', error);
      throw error;
    }
  }

  async createEmbedding(text: string): Promise<number[]> {
    try {
      const response: CreateEmbeddingResponse = await this.openai.embeddings.create({
        model: "text-embedding-3-large",
        input: text,
        dimensions: this.embeddingDimensions,
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error("Error creating embedding:", error);
      throw error;
    }
  }

  getEmbeddingDimensions(): number {
    return this.embeddingDimensions;
  }
}

