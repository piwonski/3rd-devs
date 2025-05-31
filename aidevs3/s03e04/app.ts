import { HeadquartersService } from '../shared/HeadquartersService';
import { LangfuseService } from '../shared/LangfuseService';
import { OpenAIService } from '../shared/OpenAIService';
import { RequestService } from '../shared/RequestService';
import { ExpenseCounter } from '../shared/ExpenseCounter';
import { v4 as uuidv4 } from 'uuid';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import type { LangfuseTraceClient } from 'langfuse';
import { CacheService } from '../shared/CacheService';
import path from 'path';

const cacheDir = path.join(__dirname, 'cache');

const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);
const langfuseService = new LangfuseService();
const openAIService = new OpenAIService();
const expenseCounter = new ExpenseCounter();
const cacheService = new CacheService(cacheDir);

// Initialize cache directory
await cacheService.ensureCacheDirectory();

async function findBarbara(names: string[], cities: string[], wrongCities: Set<string> = new Set()) {
    const visitedNames = new Set<string>();
    const visitedCities = new Set<string>();
    const nameQueue = [...names];
    const cityQueue = [...cities];
    let barbaraLocation: string | null = null;

    while ((nameQueue.length > 0 || cityQueue.length > 0) && !barbaraLocation) {
        // Process names queue
        if (nameQueue.length > 0) {
            const currentName = nameQueue.shift()!;
            if (!visitedNames.has(currentName)) {
                visitedNames.add(currentName);
                console.log(`Querying people API for: ${currentName}`);
                const response = await headquartersService.queryPeople(currentName);

                console.log('Places for person ', currentName, ':', response);

                const newPlaces = response.message === '[**RESTRICTED DATA**]' 
                    ? []
                    : response.message
                        .split(' ')
                        .map(place => place.trim())
                        .filter(place => place.length > 0);

                console.log('New places:', newPlaces);
                
                for (const place of newPlaces) {
                    if (!visitedCities.has(place) && !wrongCities.has(place)) {
                        cityQueue.push(place);
                    }
                }
            }
        }

        // Process cities queue
        if (cityQueue.length > 0) {
            const currentCity = cityQueue.shift()!;
            if (!visitedCities.has(currentCity) && !wrongCities.has(currentCity)) {
                visitedCities.add(currentCity);
                console.log(`Querying places API for: ${currentCity}`);
                const response = await headquartersService.queryPlaces(currentCity);

                console.log('People for city ', currentCity, ':', response, '\n');

                const newPeople = response.message.split(' ').map(person => person.trim()).filter(person => person.length > 0);

                console.log('New people for city ', currentCity, ':', newPeople, '\n');
                
                if (newPeople.includes('BARBARA')) {
                    barbaraLocation = currentCity;
                    break;
                }

                for (const person of newPeople) {
                    if (!visitedNames.has(person)) {
                        nameQueue.push(person);
                    }
                }
            }
        }
    }

    return barbaraLocation;
}

async function extractNamesAndCities(trace: LangfuseTraceClient, text: string) {
    return cacheService.getOrFetch('names-and-cities.json', async () => {
        const prompt = `Extract from the following text two lists:
1. A list of all person names (first names).
2. A list of all city names

Please use nominative case form, for example: 
1. "Jan" NOT "Jana".
2. "Warszawa" NOT "Warszawy".

Use only latin characters, for example:
1. "Rafal" NOT "Rafał".
2. "Krakow" NOT "Kraków"

Return the result as a JSON object with two arrays: "names" and "cities".

Text:
${text}`;

        const generation = langfuseService.createGeneration(trace, 'extract-names-and-cities', {
            prompt,
            report: text
        });

        const response = await openAIService.completion({
            messages: [
                { role: "system", content: "You are a helpful assistant that extracts information from text. Always respond with valid JSON." },
                { role: "user", content: prompt }
            ],
            jsonMode: true,
            stream: false
        }) as ChatCompletion;

        langfuseService.finalizeGeneration(generation, response, response.model, {
            promptTokens: response.usage?.prompt_tokens,
            completionTokens: response.usage?.completion_tokens,
            totalTokens: response.usage?.total_tokens
        });

        expenseCounter.increaseCost(response);

        return response.choices[0].message.content || '{}';
    });
}

async function fetchBarbaraData() {
    return cacheService.getOrFetch('barbara.txt', () => headquartersService.getBarbaraData());
}

async function main() {
    console.log('S03E04');

    const trace = langfuseService.createTrace({id: uuidv4(), name: 'S03E04', sessionId: uuidv4()});

    console.log('Fetching Barbara data...');
    const barbaraData = await fetchBarbaraData();
    console.log('Barbara data:', barbaraData, '\n');

    console.log('Extracting names and cities...');
    const extractedData = await extractNamesAndCities(trace, barbaraData);
    const { names, cities } = JSON.parse(extractedData);
    
    console.log('\nExtracted names:', names);
    console.log('\nExtracted cities:', cities);

    const wrongCities = new Set<string>();
    let barbaraLocation: string | null = null;
    let reportResponse;

    do {
        console.log('\nSearching for Barbara...');
        barbaraLocation = await findBarbara(names, cities, wrongCities);
        
        if (barbaraLocation) {
            console.log('\nFound Barbara in:', barbaraLocation);
            reportResponse = await headquartersService.report('loop', barbaraLocation);
            console.log('\nReport response:', reportResponse);
            
            if (reportResponse.code !== 0) {
                console.log('\nWrong location, adding to wrong cities list');
                wrongCities.add(barbaraLocation);
                barbaraLocation = null;
            }
        } else {
            console.log('\nCould not find Barbara\'s location');
            break;
        }
    } while (barbaraLocation === null);

    console.log('\nUsed tokens:', expenseCounter.getUsedTokens());
}

// Call the main function
console.log('About to call main()...');
main().catch(error => {
    console.error('Error in main:', error);
    console.error('Error stack:', error.stack);
});