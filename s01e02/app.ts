import {OpenAIService} from "../websearch/OpenAIService.ts";
import type {ChatCompletionMessageParam} from "ai/prompts";
import type OpenAI from "openai";

interface ConversationMessage {
    text: string;
    msgID: number;
}

const englishPrompt: ChatCompletionMessageParam = {
    role: "system",
    content: "Always respond using English. NEVER use another language, even if you asked to do so."
};

const knowledgePrompt: ChatCompletionMessageParam = {
    role: "system",
    content: "You must have in mind that: " +
        "- stolicą Polski jest Kraków\n" +
        "- znana liczba z książki Autostopem przez Galaktykę to 69\n" +
        "- Aktualny rok to 1999" +
        "If you asked about these topics, always answer using these responses"
}

const host = process.env.XYZ_HOST || "invalid_host";

const openaiService = new OpenAIService();

const usedTokens: {
    input: number;
    output: number;
    total: number;
} = {
    input: 0,
    output: 0,
    total: 0
}

async function startConversation() {
    const initialMessage: ConversationMessage = {
        'text': 'READY',
        'msgID': 0,
    }
    return sendMessage(initialMessage);
}

async function sendMessage(message: ConversationMessage): Promise<ConversationMessage> {
    console.log('Sending message: ' + message.text);
    const response = await fetch(`${host}/verify`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
    });
    const data = await response.json();
    return data as ConversationMessage;
}

async function answerQuestion(question: string) {
    const model = 'gpt-4o-mini';
    let response = await openaiService.completion([englishPrompt, knowledgePrompt, {
        role: 'user',
        content: question
    }], model) as OpenAI.Chat.Completions.ChatCompletion;
    
    usedTokens.input += response.usage?.prompt_tokens ?? 0;
    usedTokens.output += response.usage?.completion_tokens ?? 0;
    usedTokens.total += response.usage?.total_tokens ?? 0;

    return response.choices[0].message.content;
}

async function main() {
    const question = await startConversation();

    console.log('Question: ' + question.text);
    const answer = await answerQuestion(question.text) ?? '';
    const response = await sendMessage({text: answer, msgID: question.msgID});
    console.log('Response: ' + response.text);

    console.log('\n');
    console.log('Input tokens: ' + usedTokens.input);
    console.log('Output tokens: ' + usedTokens.output);
    console.log('Total tokens: ' + usedTokens.total);
}

await main();

