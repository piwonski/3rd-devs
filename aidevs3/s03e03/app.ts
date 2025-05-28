import type OpenAI from 'openai';
import {HeadquartersService} from '../shared/HeadquartersService';
import {LangfuseService} from '../shared/LangfuseService';
import {OpenAIService} from '../shared/OpenAIService';
import {RequestService} from '../shared/RequestService';
import {ExpenseCounter} from '../shared/ExpenseCounter';
import {v4 as uuidv4} from 'uuid';
import type {LangfuseTraceClient} from 'langfuse';

const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);

const openAIService = new OpenAIService();
const langfuseService = new LangfuseService();
const expenseCounter = new ExpenseCounter();

async function findCreateTableQuery(trace: LangfuseTraceClient, tableStructure: any) {
    const findCreateTablePrompt = `
    You are an SQL expert. You are given a document containing SQL statement used for database table creation.
    You need to only extract the creation query for the table.
    Do not change the query.

    <document>
        ${JSON.stringify(tableStructure)}
    <document>
    `

    const generation = langfuseService.createGeneration(trace, 'S03E03/query', {prompt: findCreateTablePrompt});

    const completion = await openAIService.completion({ messages: [{ role: 'user', content: findCreateTablePrompt }], model: 'gpt-4.1' }) as OpenAI.Chat.Completions.ChatCompletion;
    
    langfuseService.finalizeGeneration(generation, completion, completion.model, {
        promptTokens: completion.usage?.prompt_tokens,
        completionTokens: completion.usage?.completion_tokens,
        totalTokens: completion.usage?.total_tokens
    });
    expenseCounter.increaseCost(completion);

    return completion.choices[0].message.content;
}

async function findInactiveManagers(trace: LangfuseTraceClient, createUsersTableQuery: string, createDatacentersTableQuery: string) {
    const queryPrompt = `
    You are an SQL expert. You are given SQL table creation statements:

    ${createUsersTableQuery}

    ${createDatacentersTableQuery}
    

    You need to create a query to create SQL query to find active datacenters with inactive managers.
    The result query MUST be in SQL language.
    The answer MUST contain only the query itself, no other text.
    Do not precede the query with 'sql' or any other prefix.
    Do not change the table names or column names from the document. Do not use singular form when plural form was used in the document.
    `

    const generation = langfuseService.createGeneration(trace, 'S03E03/query', {prompt: queryPrompt});
    const completion = await openAIService.completion({
        messages: [{role: 'user', content: queryPrompt}],
        model: 'gpt-4.1'
    }) as OpenAI.Chat.Completions.ChatCompletion;

    langfuseService.finalizeGeneration(generation, completion, completion.model, {
        promptTokens: completion.usage?.prompt_tokens,
        completionTokens: completion.usage?.completion_tokens,
        totalTokens: completion.usage?.total_tokens
    });
    expenseCounter.increaseCost(completion);

    return completion.choices[0].message.content;
}

async function main() {
    // First, let's get the list of tables
    const tablesResponse = await headquartersService.queryDb('database', 'SHOW TABLES;');
    console.log('Available tables:', tablesResponse, '\n');

    // Get structure of users and datacenter tables
    const usersStructure = await headquartersService.queryDb('database', 'SHOW CREATE TABLE users;');
    const datacenterStructure = await headquartersService.queryDb('database', 'SHOW CREATE TABLE datacenters;');
    
    console.log('Users table structure:', usersStructure, '\n');
    console.log('Datacenter table structure:', datacenterStructure, '\n');

    const trace = langfuseService.createTrace({id: uuidv4(), name: 'S03E01/facts-summaries', sessionId: uuidv4()});
    
    const createUsersTableQuery = await findCreateTableQuery(trace, usersStructure);
    const createDatacentersTableQuery = await findCreateTableQuery(trace, datacenterStructure);

    console.log('Users table creation query:\n', createUsersTableQuery, '\n');
    console.log('Datacenters table creation query:\n', createDatacentersTableQuery, '\n');

    if (!createUsersTableQuery || !createDatacentersTableQuery) {
        throw new Error('No table creation query found');
    }

    const inactiveManagersQuery = await findInactiveManagers(trace, createUsersTableQuery, createDatacentersTableQuery);
    if (!inactiveManagersQuery) {
        throw new Error('No query generated');
    }

    console.log('Query:\n', inactiveManagersQuery, '\n');

    // Execute the query
    const result = await headquartersService.queryDb('database', inactiveManagersQuery);
    console.log('Query result:', result, '\n');

    // Extract DC_IDs from the result
    const dcIds = result.reply.map((row: any) => row.dc_id);

    // Send the answer to headquarters
    const report = await headquartersService.report('database', dcIds);
    console.log('Report response:', report, '\n');

    console.log("Used tokens: " + JSON.stringify(expenseCounter.getUsedTokens()));
}

await main();
