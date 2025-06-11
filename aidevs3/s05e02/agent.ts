import { CacheService } from '../shared/CacheService';
import { DownloadService } from '../shared/DownloadService';
import { HeadquartersService } from '../shared/HeadquartersService';
import { OpenAIService } from '../shared/OpenAIService';
import { RequestService } from '../shared/RequestService';
import { UnzipService } from '../shared/UnzipService';
import { ExpenseCounter } from '../shared/ExpenseCounter';
import * as path from 'path';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { User } from '../shared/sharedTypes';

interface Decision {
    action: string;
    parameters: Record<string, string>;
    reason: string;
}

interface AgentState {
    question: string;
    place: string;
    allGpsData: { [key: string]: { lat: number, lon: number } };
    peopleAtCity: User[];
    decision: Decision;
}

export class Agent {
    private readonly requestService: RequestService;
    private readonly headquartersService: HeadquartersService;
    private readonly cacheService: CacheService;
    private readonly downloadService: DownloadService;
    private readonly unzipService: UnzipService;
    private readonly openAIService: OpenAIService;
    private readonly expenseCounter: ExpenseCounter;
    private readonly cacheDir: string;
    private readonly state: AgentState;
    
    constructor() {
        this.cacheDir = path.join(__dirname, 'cache');
        this.requestService = new RequestService();
        this.headquartersService = new HeadquartersService(this.requestService);
        this.cacheService = new CacheService(this.cacheDir);
        this.downloadService = new DownloadService(this.cacheDir);
        this.unzipService = new UnzipService(this.cacheDir);
        this.expenseCounter = new ExpenseCounter();
        this.openAIService = new OpenAIService(3072, this.expenseCounter);
        this.state = {
            question: '',
            place: '',
            allGpsData: {},
            peopleAtCity: [],
            decision: { action: '', parameters: {}, reason: '' }
        };
    }

    async run() {
        console.log("🚀 Agent starting...");

        // Ensure cache directory exists
        await this.cacheService.ensureCacheDirectory();

        await this.solve();

        console.log("✅ Agent completed successfully");
    }

    async decide() {
        const systemPrompt = `You are an AI agent that helps locate people using GPS data. You have access to three tools:

1. query_places(place_name) - Gets a list of people in a specific location
2. get_user_id(name) - Gets an user id based on a name
3. get_gps_data(userID) - Gets current GPS coordinates for a specific user
4. done - When you have all the data, you can use this action to submit the answer

Your task is to:
1. First, use query_places to find people in the location mentioned in the question
2. Then, for each person (except Barbara), get their GPS coordinates using get_gps_data
3. Finally, combine all the data into a single response

You should respond in JSON format with the following structure:
{
    "action": "query_places" | "get_user_id" | "get_gps_data" | "done",
    "parameters": {
        // parameters for the selected action
    },
    "reason": "explanation of why you chose this action"
}

For example:
- To query places: {"action": "query_places", "parameters": {"place": "Krakow"}, "reason": "Need to find people at this city"}
- To get user id: {"action": "get_user_id", "parameters": {"name": "John"}, "reason": "Getting user id for John"}
- To get GPS: {"action": "get_gps_data", "parameters": {"userID": "123"}, "reason": "Getting location for John"}
- When done: {"action": "done", "parameters": {}, "reason": "All required data collected"}

Current state (what you know so far):
- Question: ${this.state.question}
- Place: ${this.state.place}
- People found: ${JSON.stringify(this.state.peopleAtCity)}
- GPS data collected: ${JSON.stringify(this.state.allGpsData)}
`;

        const messages: ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: this.state.question }
        ];

        const response = await this.openAIService.completion({
            messages,
            jsonMode: true
        });

        if ('choices' in response) {
            this.state.decision = JSON.parse(response.choices[0].message.content || '{}');
        }

        return this.state.decision;
    }

    async solve() {
        // 1. Get the question
        const question = await this.cacheService.getOrFetchJson('gps_questions.json', async () => {
            return await this.headquartersService.getGPSQuestion();
        });
        console.log("🔍 Question:", question);

        this.state.question = question;
        
        const maxIterations = 20;
        let iteration = 0;

        while (iteration < maxIterations) {
            const decision = await this.decide();
            console.log("🤖 AI Decision:", decision);

            switch(decision.action) {
                case 'query_places':
                    const place = decision.parameters.place;
                    console.log("🔍 Querying place:", place);
                    this.state.place = place;
                    const peopleResponse = await this.headquartersService.queryPlaces(place);
                    const people = ((peopleResponse.message) as string).split(' ');
                    console.log("👥 People found at city:", peopleResponse.message);
                    this.state.peopleAtCity = people.map(name => ({ username: name } as User));
                    break;
                case 'get_user_id':
                    const name = decision.parameters.name;
                    console.log("🔍 Querying user:", name);
                    const user = await this.headquartersService.queryUser(name);
                    console.log("👥 User found:", user);
                    this.state.peopleAtCity.push(user);
                    break;
                case 'get_gps_data':
                    const userID = decision.parameters.userID;
                    console.log("🔍 Querying GPS data for user:", userID);
                    const gps = await this.headquartersService.getGPSData(userID);
                    console.log("🌍 GPS data:", gps);
                    // todo: use username instead of userID
                    this.state.allGpsData[userID] = gps;
                    break;
                case 'done':
                    console.log("🎉 All required data collected");
                    console.log("💾 All GPS data:", this.state.allGpsData);
                    console.log("👥 People at city:", this.state.peopleAtCity);
                    console.log("🏁 Agent completed successfully");
                    const reportResponse = await this.headquartersService.report('gps', this.state.allGpsData);
                    console.log("✅ Report response:", reportResponse);
                    console.log("💰 Token usage:", this.expenseCounter.getUsedTokens());
                    console.log("💵 Estimated cost:", this.expenseCounter.getEstimatedCost());
                    return;
                default:
                    console.error(`Unknown action: ${decision.action}`);
                    break;
            }
            iteration++;
        }

        console.error("❌ Agent failed to complete the task after 10 iterations");
        console.error("💾 All GPS data:", this.state.allGpsData);
        console.error("👥 People at city:", this.state.peopleAtCity);
        console.error("💰 Token usage:", this.expenseCounter.getUsedTokens());
        console.error("💵 Estimated cost:", this.expenseCounter.getEstimatedCost());
        return;
    }
}