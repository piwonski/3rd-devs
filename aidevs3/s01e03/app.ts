import type OpenAI from "openai";
import { ExpenseCounter } from "../shared/ExpenseCounter.ts";
import { RequestService } from "../shared/RequestService.ts";
import {type CalibrationData, type TestItem, type TestQuestion } from "./taskTypes.ts";
import {OpenAIService} from "../shared/OpenAIService.ts";
import type {HeadquartersResponse, ReportBody} from "../shared/sharedTypes.ts";

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
        answer: performMathematicalOperation(item.question),
        test: await generateFixedTestQuestion(item.test),
    };
}

function performMathematicalOperation(question: string): number {
    // Extract numbers and operator from the question
    const [num1, operator, num2] = question.split(' ');

    // Convert strings to numbers
    const a = parseInt(num1);
    const b = parseInt(num2);

    // Perform the operation
    let result = 0;
    switch (operator) {
        case '+':
            result = a + b;
            break;
        case '-':
            result = a - b;
            break;
        case '*':
            result = a * b;
            break;
        case '/':
            result = a / b;
            break;
    }

    return result;
}

async function generateFixedTestQuestion(test?: TestQuestion): Promise<TestQuestion | undefined> {
    if (!test) {
        return undefined;
    }
    const model = 'gpt-4.1-nano';
    const completion = await openaiService.completion([{
        role: "user",
        content: test.q 
    }], model) as OpenAI.Chat.Completions.ChatCompletion;
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
    const reportBody: ReportBody<CalibrationData> = {
        task: "JSON",
        apikey: apiKey,
        answer: fixedCalibrationData,
    };
    const report = await requestService.post<ReportBody<CalibrationData>, HeadquartersResponse>(`${host}/report`, reportBody);
    console.log(report);

    console.log("Used tokens: " + JSON.stringify(expenseCounter.getUsedTokens()));
}

await main();