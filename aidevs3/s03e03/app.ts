import type OpenAI from 'openai';
import { HeadquartersService } from '../shared/HeadquartersService';
import { LangfuseService } from '../shared/LangfuseService';
import { OpenAIService } from '../shared/OpenAIService';
import { RequestService } from '../shared/RequestService';
import { ExpenseCounter } from '../shared/ExpenseCounter';
import { v4 as uuidv4 } from 'uuid';

const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);

const openAIService = new OpenAIService();
const langfuseService = new LangfuseService();
const expenseCounter = new ExpenseCounter();

async function main() {
    // First, let's get the list of tables
    const tablesResponse = await headquartersService.queryDb('database', 'SHOW TABLES;');
    console.log('Available tables:', tablesResponse, '\n');

    // Get structure of users and datacenter tables
    const usersStructure = await headquartersService.queryDb('database', 'SHOW CREATE TABLE users;');
    const datacenterStructure = await headquartersService.queryDb('database', 'SHOW CREATE TABLE datacenters;');
    
    console.log('Users table structure:', usersStructure, '\n');
    console.log('Datacenter table structure:', datacenterStructure, '\n');

    const queryPrompt = `
    You are an SQL expert. You are given a list of tables and their structures.    
    You need to create a query to find active datacenters with inactive managers.
    The query should be in SQL language.
    The answer MUST contain only the query itself, no other text.
    Be attentive to the table names and column names, if table name is in singular, use singular form of the column name, if table name is in plural, use plural form of the column name.
    Do not precede the query with 'sql' or any other prefix.
    Imagine that you're result will be executed directly in the database.

    <tables>
        <users>
            ${usersStructure.reply}
        </users>
        <datacenter>
            ${datacenterStructure.reply}
        </datacenter>
    </tables>
    `
    const trace = langfuseService.createTrace({id: uuidv4(), name: 'S03E01/facts-summaries', sessionId: uuidv4()});

    const generation = langfuseService.createGeneration(trace, 'S03E03/query', {prompt: queryPrompt});
    const completion = await openAIService.completion({ messages: [{ role: 'user', content: queryPrompt }], model: 'gpt-4.1' }) as OpenAI.Chat.Completions.ChatCompletion;
    
    langfuseService.finalizeGeneration(generation, completion, completion.model, {
        promptTokens: completion.usage?.prompt_tokens,
        completionTokens: completion.usage?.completion_tokens,
        totalTokens: completion.usage?.total_tokens
    });
    expenseCounter.increaseCost(completion);
    
    const query = completion.choices[0].message.content;
    if (!query) {
        throw new Error('No query generated');
    }

    console.log('Query:\n', query, '\n');

    // Execute the query
    const result = await headquartersService.queryDb('database', query);
    console.log('Query result:', result, '\n');

    // Extract DC_IDs from the result
    const dcIds = result.reply.map((row: any) => row.DC_ID);

    // Send the answer to headquarters
    const report = await headquartersService.report('database', dcIds);
    console.log('Report response:', report, '\n');

    console.log("Used tokens: " + JSON.stringify(expenseCounter.getUsedTokens()));
}

await main();
