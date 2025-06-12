import { Environment } from "../shared/Environment";
import { RequestService } from "../shared/RequestService";

export interface RafalTask {
	signature: string;
	timestamp: number;
	challenges: string[];
}

export class Agent {
    private readonly requestService: RequestService;
    private readonly apiKey: string;

    constructor() {
        this.requestService = new RequestService();
        this.apiKey = Environment.getCentralaApiKey();
    }

    async run() {
        console.log("🤖 Agent running...");

        const reponses = [
            'zakazano wnoszenia napojów i posiłków do pomieszczenia z komorą temporalną', 
            'Brave New World',
            'Fiodor Dostojewski',
            'Bogurodzica',
            '3 maja 1791 roku',
            'Toruń',
        ]

        const ralalHash = await this.getRalalHash();
        console.log("🔍 Ralal hash:", ralalHash);

        const rafalTask = await this.getRafalTask(ralalHash);
        console.log("🤔 Rafal task:", rafalTask);

        await this.solveRafalTask(rafalTask, reponses);
    }

    private async solveRafalTask(rafalTask: RafalTask, responses: string[]) {
        const endpoint = "https://rafal.ag3nts.org/b46c3";

        const response = await this.requestService.post(endpoint, {
            apikey: this.apiKey,
            timestamp: rafalTask.timestamp,
            signature: rafalTask.signature,
            answer: responses
          });

          console.log("🤖 Rafal response:", response);
    }

    private async getRalalHash(): Promise<string> {
        // Użyj prawdziwego endpointa i hasła od Tomasza
        const endpoint = "https://rafal.ag3nts.org/b46c3";
        const password = "NONOMNISMORIAR";
                    
        const response = await this.requestService.post(endpoint, {
            password: password
        });
                    
        // Return just the message value, not the whole response
        if (response && typeof response === 'object' && 'message' in response) {
            return response.message as string;
        }
                    
        return JSON.stringify(response);
    }

    private async getRafalTask(hash: string): Promise<RafalTask> {
        const endpoint = "https://rafal.ag3nts.org/b46c3";

        const response = await this.requestService.post(endpoint, {
            sign: hash
        });

        if (response && typeof response === 'object' && 'message' in response) {
            return response.message as RafalTask;
        }

        throw new Error(`Unexpected response from getRafalTask: ${JSON.stringify(response)}`);
    }
}