import { Environment } from './Environment';
import { RequestService } from './RequestService';

export class HeadquartersService {
    private readonly requestService: RequestService;
    private readonly host: string;
    private readonly apiKey: string;

    constructor(requestService: RequestService) {
        this.requestService = requestService;
        this.host = Environment.getHeadquartersHost();
        this.apiKey = Environment.getCentralaApiKey();
    }

    async getUncensoredFile(): Promise<string> {
        return this.requestService.getText(`${this.host}/data/${this.apiKey}/cenzura.txt`);
    }
}
