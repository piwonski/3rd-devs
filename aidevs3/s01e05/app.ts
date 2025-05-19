import {HeadquartersService} from "../shared/HeadquartersService.ts";
import {RequestService} from "../shared/RequestService.ts";
import {OpenAIService} from "../shared/OpenAIService.ts";
import {ExpenseCounter} from "../shared/ExpenseCounter.ts";
import type {ChatCompletionMessageParam} from "ai/prompts";
import OpenAI from "openai";

import ollama from 'ollama';

const headquartersService = new HeadquartersService(new RequestService());
const openaiService = new OpenAIService();
const expenseCounter = new ExpenseCounter();


const anonymisePrompt = `
You are given a file with sensitive data, containing names, addresses, age, etc.
You need to return the text with sensitive data replaced with 'CENZURA' word.

Examples:
<input>Informacje o podejrzanym: Adam Nowak. Mieszka w Katowicach przy ulicy Tuwima 10. Wiek: 32 lata.</input>
<output>Informacje o podejrzanym: CENZURA. Mieszka w CENZURA przy ulicy CENZURA. Wiek: CENZURA lata.</output>

<input>Dane personalne podejrzanego: Wojciech Górski. Przebywa w Lublinie, ul. Akacjowa 7. Wiek: 27 lat.</input>
<output>Dane personalne podejrzanego: CENZURA. Przebywa w CENZURA, ul. CENZURA. Wiek: CENZURA lat.</output>
`;

async function main() {
    const sensitiveData = await headquartersService.getSensitiveData();
    console.log(sensitiveData);

    console.time('anonymization');
    // const anonymisedData = await anonymizeUsingGpt(sensitiveData);
    const anonymisedData = await anonymizeUsingOllama(sensitiveData);
    console.log(anonymisedData);
    console.timeEnd('anonymization');

    const response = await headquartersService.report('CENZURA', anonymisedData);
    console.log(response);

    // console.log(expenseCounter.getUsedTokens());
}

async function anonymizeUsingGpt(sensitiveData: string) {
    const model = 'gpt-4.1-nano';
    const systemPrompt: ChatCompletionMessageParam = {
        role: "system",
        content: anonymisePrompt
    };
    const completion = await openaiService.completion({
        messages: [systemPrompt, {
            role: "user",
            content: sensitiveData
        }], model
    }) as OpenAI.Chat.Completions.ChatCompletion;
    expenseCounter.increaseCost(completion);
    return completion.choices[0].message.content
}

async function anonymizeUsingOllama(sensitiveData: string) {
    // [phi4-mini, gemma3:4b, llama3.2:3b]
    const model = 'gemma3:4b';
    const systemPrompt = {
        role: 'system',
        content: anonymisePrompt
    };
    const response = await ollama.chat({
        model,
        messages: [systemPrompt, {role: 'user', content: sensitiveData}]
    });
    return response.message.content;
}

await main();
