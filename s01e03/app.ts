import type OpenAI from "openai";
import { ExpenseCounter } from "./ExpenseCounter";
import { OpenAIService } from "./OpenAIService";
import { RequestService } from "./RequestService";
import {type CalibrationData, type TestItem, type TestQuestion, type HeadquartersResponse, type ReportBody } from "./types";

if (!process.env.CENTRALA_HOST) {
  throw new Error("CENTRALA_HOST env variable is not set");
}
if (!process.env.CENTRALA_API_KEY) {
  throw new Error("CENTRALA_API_KEY env variable is not set");
}
const host = process.env.CENTRALA_HOST;
const apiKey = process.env.CENTRALA_API_KEY;

const requestService = new RequestService();
const expenseCounter = new ExpenseCounter();
const openaiService = new OpenAIService();

async function generateFixedItem(item: TestItem): Promise<TestItem> {
    return {
        question: item.question,
        answer: item.answer,
        test: await generateFixedTestQuestion(item.test),
    };
}

async function generateFixedTestQuestion(test?: TestQuestion): Promise<TestQuestion | undefined> {
    if (!test) {
        return undefined;
    }
    const completion = await openaiService.completion([{
        role: "user",
        content: test.q
    }]) as OpenAI.Chat.Completions.ChatCompletion;
    expenseCounter.increaseCost(completion);

    const answer = completion.choices[0].message.content;
    
    console.log("Question: " + test.q);
    console.log("Answer: " + answer);
    
    return {
        q: test.q,
        a: answer ?? test.a,
    };
}

async function main() {
    const calibrationData = await requestService.get<CalibrationData>(`${host}/data/${apiKey}/json.txt`);
    const testData = calibrationData["test-data"];
    const fixedTestData = await Promise.all(testData.map(async (item) => {
        return await generateFixedItem(item)
    }));

    const fixedCalibrationData = {...calibrationData, apikey: apiKey, "test-data": fixedTestData};
    const reportBody: ReportBody = {
        task: "JSON",
        apikey: apiKey,
        answer: fixedCalibrationData,
    };
    const report = await requestService.post<ReportBody, HeadquartersResponse>(`${host}/report`, reportBody);
    console.log(report);
    
    console.log("Used tokens: " + JSON.stringify(expenseCounter.getUsedTokens()));
}

await main();