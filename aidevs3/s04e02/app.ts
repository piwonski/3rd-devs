import { readFileSync } from 'fs';
import { join } from 'path';
import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';
import { ExpenseCounter } from '../shared/ExpenseCounter';
import { OpenAIService } from '../shared/OpenAIService';
import { LangfuseService } from '../shared/LangfuseService';
import type OpenAI from 'openai';
import type { LangfuseTraceClient } from 'langfuse';
import { v4 as uuidv4 } from 'uuid';

const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);
const expenseCounter = new ExpenseCounter();
const openAIService = new OpenAIService();
const langfuseService = new LangfuseService();

async function validateWords(entry: string, trace: LangfuseTraceClient): Promise<boolean> {
    const generation = langfuseService.createGeneration(trace, 'validate-words', {
        words: entry
    });

    try {
        const completion = await openAIService.completion({
            model: 'gpt-4.1-mini-2025-04-14:aidevs-research',
            messages: [
                {
                    role: 'system',
                    content: 'validate data. Respond with only 1 if entry is valid, 0 if invalid.'
                },
                {
                    role: 'user',
                    content: entry
                }
            ]
        }) as OpenAI.Chat.Completions.ChatCompletion;

        expenseCounter.increaseCost(completion);
        langfuseService.finalizeGeneration(generation, completion, completion.model, {
            promptTokens: completion.usage?.prompt_tokens,
            completionTokens: completion.usage?.completion_tokens,
            totalTokens: completion.usage?.total_tokens
        });
        
        const content = completion.choices[0].message.content;
        if (!content) {
            throw new Error('No content in response');
        }

        const response = content.trim();
        if (response !== '1' && response !== '0') {
            throw new Error(`Invalid response format: ${response}. Expected 1 or 0.`);
        }

        return response === '1';
    } catch (error) {
        langfuseService.finalizeGeneration(
            generation,
            { error: error instanceof Error ? error.message : 'Unknown error' },
            'gpt-4.1-mini-2025-04-14:aidevs-research'
        );
        throw error;
    }
}

async function main() {
    const trace = langfuseService.createTrace({
        id: uuidv4(),
        name: 'S04E02-verify-entries',
        sessionId: uuidv4()
    });

    try {
        // Read and parse verify.txt
        const verifyPath = join(__dirname, 'input-files', 'verify.txt');
        const content = readFileSync(verifyPath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());

        // Create array of validation promises
        const validationPromises = lines.map(async (line) => {
            const [id, wordsStr] = line.split('=');
            const isValid = await validateWords(wordsStr, trace);
            return { id, isValid };
        });

        // Wait for all validations to complete
        const results = await Promise.all(validationPromises);

        // Filter valid entries and get their IDs
        const validEntryIds = results
            .filter(result => result.isValid)
            .map(result => result.id);

        // Report valid entries
        const headquartersResponse = await headquartersService.report('verify', validEntryIds);
        console.log('Headquarters response:', headquartersResponse);

        console.log("Used tokens:", JSON.stringify(expenseCounter.getUsedTokens()));

        await langfuseService.finalizeTrace(trace, {
            totalEntries: lines.length
        }, {
            validEntries: validEntryIds.length,
            validEntryIds
        });

    } catch (error) {
        await langfuseService.finalizeTrace(trace, {}, {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        console.error('Error:', error);
    }
}

await main();