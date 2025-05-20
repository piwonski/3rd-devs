import {OpenAIService} from "../shared/OpenAIService.ts";
import path from "path";
import fs from "fs";
import {readFile} from "fs/promises";
import type {ChatCompletionContentPartImage, ChatCompletionMessageParam} from "ai/prompts";
import type OpenAI from "openai";
import {ExpenseCounter} from "../shared/ExpenseCounter.ts";
import ollama from "ollama";

const openAIService = new OpenAIService();
const expenseCounter = new ExpenseCounter();
const mapDirectoryName = 'maps';

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

async function main() {
    const mapFiles = fs.readdirSync(path.join(__dirname, mapDirectoryName));
    console.log('Map files:', mapFiles);
    if (mapFiles.length === 0) {
        console.error('No map files found');
        return;
    }


    console.log('Investigating city name...');

    const response = await findCityUsingOllama(mapFiles);
    console.log(response);

    console.log("Used tokens: " + JSON.stringify(expenseCounter.getUsedTokens()));
}

async function getImageBase64(file: string) {
    const filePath = path.join(__dirname, mapDirectoryName, file);
    const fileData = await readFile(filePath);
    return fileData.toString('base64');
}

async function findCityUsingOpenAI(mapFiles: string[]) {
    const imagePromptMessages: ChatCompletionMessageParam[] = await Promise.all(mapFiles.map(async (file) => {
        const base64Image = await getImageBase64(file);
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
    const completion = await openAIService.completion({
        messages: [{role: "system", content: systemPrompt}, ...imagePromptMessages],
        jsonMode: true,
        model: "gpt-4o",
    }) as OpenAI.Chat.Completions.ChatCompletion;
    expenseCounter.increaseCost(completion);

    return completion.choices[0].message.content;
}

async function findCityUsingOllama(mapFiles: string[]) {
    const base64Images = await Promise.all(mapFiles.map(getImageBase64));

    console.time('ollama investigation');    
    const response = await ollama.chat({
        model: "llava",
        messages: [
            { role: "system", content: systemPrompt },
            { 
                role: "user", 
                content: `Analyze these map images and determine the city name. Here are the maps: ${base64Images.join('\n')}`
            }
        ]
    });
    console.timeEnd('ollama investigation');

    return response.message.content;
}

await main();