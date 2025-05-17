import { Environment } from './Environment';
import { RequestService } from './RequestService';
import type {ReportBody, HeadquartersResponse} from "./sharedTypes.ts";

export class HeadquartersService {
    private readonly requestService: RequestService;
    private readonly host: string;
    private readonly apiKey: string;

    constructor(requestService: RequestService) {
        this.requestService = requestService;
        this.host = Environment.getHeadquartersHost();
        this.apiKey = Environment.getCentralaApiKey();
    }

    async getSensitiveData(): Promise<string> {
        return this.requestService.getText(`${this.host}/data/${this.apiKey}/cenzura.txt`);
    }
    
    report<ANSWER>(task: string, answer: ANSWER) {
        return this.requestService.post<ReportBody<ANSWER>, HeadquartersResponse>(`${this.host}/report`, { task, apikey: this.apiKey, answer });
    }
}
