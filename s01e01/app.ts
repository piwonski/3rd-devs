import type OpenAI from "openai";
import {OpenAIService} from "../websearch/OpenAIService.ts";
import type {ChatCompletionMessageParam} from "ai/prompts";

const host = process.env.XYZ_HOST || "invalid_host";

const openaiService = new OpenAIService();

const systemPrompt: ChatCompletionMessageParam = {
    role: "system",
    content: "Don't use full sentences. Just provide the answer."
};

async function fetchQuestion() {
    console.log('Fetching question...');
    try {
        const response = await fetch(host);
        const html = await response.text();

        // Extract question using regex
        const questionMatch = html.match(/<p id="human-question">Question:<br \/>([^<]+)<\/p>/);
        if (questionMatch && questionMatch[1]) {
            return questionMatch[1].trim();
        } else {
            return null;
        }
    } catch (error) {
        console.error('Error fetching the page:', error);
        return null;
    }
}

async function fetchAnswer(question: string) {
    let response = await openaiService.completion([systemPrompt, {
        role: 'user',
        content: question
    }], 'gpt-4.1-nano') as OpenAI.Chat.Completions.ChatCompletion;
    return response.choices[0].message.content;
}

async function postAnswer(answer: string) {
    const formData = new URLSearchParams({
        username: 'tester',
        password: '574e112a',
        answer
    });
    return await fetch(host, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData.toString()
    });
}

async function fetchSecretFlag(responseUrl: string) {
    const hiddenPageResponse = await fetch(responseUrl);
    const hiddenPageHtml = await hiddenPageResponse.text();

    // Extract FLG value using regex
    const flgMatch = hiddenPageHtml.match(/{{FLG:([^}]+)}}/);
    if (flgMatch && flgMatch[1]) {
        return flgMatch[1];
    } else {
        return null;
    }
}

async function main() {
    const question = await fetchQuestion();
    if (!question) {
        console.log('No question found');
        return;
    }
    console.log('Found question:', question);

    const answer = await fetchAnswer(question);
    if (!answer) {
        console.log('No answer found');
        return;
    }
    console.log('Answer:', answer);

    const response = await postAnswer(answer);
    const responseUrl = response.url;
    console.log('Response URL:', responseUrl);

    const flag = await fetchSecretFlag(responseUrl);
    if (!flag) {
        console.log('No flag found');
        return;
    }
    console.log('Secret flag found:', flag);
}

await main();


