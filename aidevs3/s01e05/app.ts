import { HeadquartersService } from "../shared/HeadquartersService.ts";
import { RequestService } from "../shared/RequestService.ts";
import { OpenAIService } from "../shared/OpenAIService.ts";
import { ExpenseCounter } from "../shared/ExpenseCounter.ts";
import type {ChatCompletionMessageParam} from "ai/prompts";
import OpenAI from "openai";

const headquartersService = new HeadquartersService(new RequestService());
const openaiService = new OpenAIService();
const expenseCounter = new ExpenseCounter();


const anonymizePrompt: ChatCompletionMessageParam = {
    role: "system",
    content: `
    You are given a file with sensitive data, containing names, addresses, age, etc.
    You need to return the text with sensitive data replaced with 'CENZURA' word.
    
    Example:
    <input>Informacje o podejrzanym: Adam Nowak. Mieszka w Katowicach przy ulicy Tuwima 10. Wiek: 32 lata.</input>
    <output>Informacje o podejrzanym: CENZURA. Mieszka w CENZURA przy ulicy CENZURA. Wiek: CENZURA lata.</output>
`
};

async function main() {
    const sensitiveData = await headquartersService.getSensitiveData();
    console.log(sensitiveData);

    const anonymisedData = await anonymize(sensitiveData);

    const response = await headquartersService.report('CENZURA', anonymisedData);
    console.log(response);
    
    console.log(expenseCounter.getUsedTokens());
}

async function anonymize(sensitiveData: string) {
    const model = 'gpt-4.1-nano';
    const completion = await openaiService.completion([anonymizePrompt, {
        role: "user",
        content: sensitiveData
    }], model) as OpenAI.Chat.Completions.ChatCompletion;
    expenseCounter.increaseCost(completion);
    return completion.choices[0].message.content
}

await main();
