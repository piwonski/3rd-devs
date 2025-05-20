import {OpenAIService} from "../shared/OpenAIService.ts";
import {FileUtils} from "../shared/FileUtils.ts";
import path from "path";
import fs from "fs";
import { readFile } from "fs/promises";
import type { ChatCompletionContentPartImage, ChatCompletionMessageParam } from "ai/prompts";
import type OpenAI from "openai";
import { ExpenseCounter } from "../shared/ExpenseCounter.ts";

const openAIService = new OpenAIService();
const expenseCounter = new ExpenseCounter();

async function main() {
    const mapDirectoryName = 'maps';
    const mapFiles = fs.readdirSync(path.join(__dirname, mapDirectoryName));
    console.log('Map files:', mapFiles);
    if (mapFiles.length === 0) {
        console.error('No map files found');
        return;
    }
    const imagePromptMessages: ChatCompletionMessageParam[] = await Promise.all(mapFiles.map(async (file) => {
        const filePath = path.join(__dirname, mapDirectoryName, file);
        const fileData = await readFile(filePath);
        const base64Image = fileData.toString('base64');
        return {
            role: "user",
            content: [{
                type: "image_url",
                image_url: {
                    url: `data:image/png;base64,${base64Image}`,
                    detail: "high"
                }
            } as ChatCompletionContentPartImage]
        };
    }));

    const systemPrompt = `
    You are a map expert.
    You are given some map images.
    You need to find the city name these maps are about.
    During your analysis, you need to consider the following:
    - what are the names of the streets, buildings, etc. in the image.
    - one map may be misleading, so you need dismiss it and consider only the other maps.
    You need to return the city name in JSON format:
    {
        "thinking": "<your thinking process here>",
        "city": "<city name>"
    }
    Do not include any other text in your response.
    `;

    console.log('Investigating city name...');

    const completion = await openAIService.completion({
        messages: [{role: "system", content: systemPrompt}, ...imagePromptMessages],
        jsonMode: true,
        model: "gpt-4o",
    }) as OpenAI.Chat.Completions.ChatCompletion;
    expenseCounter.increaseCost(completion);

    const response = completion.choices[0].message.content as string;
    console.log(response);

    console.log("Used tokens: " + JSON.stringify(expenseCounter.getUsedTokens()));
}

await main();