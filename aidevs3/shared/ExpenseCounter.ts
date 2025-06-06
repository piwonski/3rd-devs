import type OpenAI from "openai";

interface UsedTokens {
    input: number;
    output: number;
    total: number;
}

interface CostBreakdown {
    inputCost: number;
    outputCost: number;
    totalCost: number;
    model: string;
}

interface ModelPricing {
    inputTokenPrice: number;  // Price per 1K tokens
    outputTokenPrice: number; // Price per 1K tokens
}

export class ExpenseCounter {
    private usedTokens: UsedTokens;
    private readonly modelPricing: Record<string, ModelPricing> = {
        'gpt-4o': {
            inputTokenPrice: 0.00250,   // $0.0025 per 1K input tokens
            outputTokenPrice: 0.01000   // $0.01 per 1K output tokens
        },
        'gpt-4.1': {
            inputTokenPrice: 0.00300,   // $0.003 per 1K input tokens
            outputTokenPrice: 0.01200   // $0.012 per 1K output tokens
        },
        'gpt-4': {
            inputTokenPrice: 0.03000,   // $0.03 per 1K input tokens
            outputTokenPrice: 0.06000   // $0.06 per 1K output tokens
        },
        'gpt-3.5-turbo': {
            inputTokenPrice: 0.00050,   // $0.0005 per 1K input tokens
            outputTokenPrice: 0.00150   // $0.0015 per 1K output tokens
        }
    };

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

    getEstimatedCost(model: string = 'gpt-4o'): CostBreakdown {
        const pricing = this.modelPricing[model];
        
        if (!pricing) {
            console.warn(`Unknown model: ${model}. Using gpt-4o pricing as fallback.`);
            const fallbackPricing = this.modelPricing['gpt-4o'];
            const inputCost = (this.usedTokens.input / 1000) * fallbackPricing.inputTokenPrice;
            const outputCost = (this.usedTokens.output / 1000) * fallbackPricing.outputTokenPrice;
            const totalCost = inputCost + outputCost;
            
            return {
                inputCost,
                outputCost,
                totalCost,
                model: `${model} (fallback to gpt-4o pricing)`
            };
        }
        
        const inputCost = (this.usedTokens.input / 1000) * pricing.inputTokenPrice;
        const outputCost = (this.usedTokens.output / 1000) * pricing.outputTokenPrice;
        const totalCost = inputCost + outputCost;
        
        return {
            inputCost,
            outputCost,
            totalCost,
            model
        };
    }

    reset() {
        this.usedTokens = { input: 0, output: 0, total: 0 };
    }
}