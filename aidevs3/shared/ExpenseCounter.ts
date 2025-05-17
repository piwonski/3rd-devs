import type OpenAI from "openai";

interface UsedTokens {
    input: number;
    output: number;
    total: number;
}

export class ExpenseCounter {
    private usedTokens: UsedTokens;

    constructor() {
        this.usedTokens = { input: 0, output: 0, total: 0 };
    }

    increaseCost(completion: OpenAI.Chat.Completions.ChatCompletion) {
        this.usedTokens.input += completion.usage?.prompt_tokens ?? 0;
        this.usedTokens.output += completion.usage?.completion_tokens ?? 0;
        this.usedTokens.total += completion.usage?.total_tokens ?? 0;
    }

    getUsedTokens() {
        return this.usedTokens;
    }

    reset() {
        this.usedTokens = { input: 0, output: 0, total: 0 };
    }
}