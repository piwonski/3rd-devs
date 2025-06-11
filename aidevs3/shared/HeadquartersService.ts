import { Environment } from './Environment';
import { RequestService } from './RequestService';
import type {ReportBody, HeadquartersResponse, QueryResponse, QueryBody, LoopApiBody, LoopApiResponse, User} from "./sharedTypes.ts";

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
        return this.requestService.getText(`${this.getApiKeyDataPath()}/cenzura.txt`);
    }

    async getRobotDescription(): Promise<string> {
        return this.requestService.getText(`${this.getApiKeyDataPath()}/robotid.json`);
    }

    async getArxivHtml(): Promise<string> {
        return this.requestService.getText(`${this.host}/dane/arxiv-draft.html`);
    }

    async getArxivQuestions(): Promise<string> {
        return this.requestService.getText(`${this.getApiKeyDataPath()}/arxiv.txt`);
    }

    async getBarbaraData(): Promise<string> {
        return this.requestService.getText(`${this.host}/dane/barbara.txt`);
    }

    async getSoftoQuestions(): Promise<string> {
        return this.requestService.getText(`${this.getApiKeyDataPath()}/softo.json`);
    }

    async getPhoneTranscriptions(): Promise<string> {
        return this.requestService.getText(`${this.getApiKeyDataPath()}/phone.txt`);
    }

    async getSortedPhoneTranscriptions(): Promise<string> {
        return this.requestService.getText(`${this.getApiKeyDataPath()}/phone_sorted.json`);
    }

    async getPhoneQuestions(): Promise<string> {
        return this.requestService.getText(`${this.getApiKeyDataPath()}/phone_questions.txt`);
    }

    async getGPSQuestion(): Promise<string> {
        const questionData = await this.requestService.getText(`${this.getApiKeyDataPath()}/gps_question.txt`);
        return JSON.parse(questionData).question;
    }

    async getGPSData(userID: string): Promise<{lat: number, lon: number}> {
        return this.requestService.post<{userID: string}, {lat: number, lon: number}>(`${this.host}/gps`, { userID });
    }
    async queryUser(name: string): Promise<User> {
        const response = await this.queryDb('database', `SELECT * FROM users WHERE username = '${name}'`);
        return response.reply[0] as User;
    }

    async queryPlaces(query: string): Promise<any> {
        return this.requestService.post<LoopApiBody, any>(`${this.host}/places`, { apikey: this.apiKey, query });
    }

    report<ANSWER>(task: string, answer: ANSWER) {
        return this.requestService.post<ReportBody<ANSWER>, HeadquartersResponse>(`${this.host}/report`, { task, apikey: this.apiKey, answer });
    }

    async queryDb(task: string, query: string) {
        return this.requestService.post<QueryBody, QueryResponse>(`${this.host}/apidb`, { task, apikey: this.apiKey, query });
    }

    private getApiKeyDataPath() {
        return `${this.getDataPath()}/${this.apiKey}`;
    }

    private getDataPath() {
        return `${this.host}/data`;
    }
}
