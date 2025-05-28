export interface ReportBody<ANSWER> {
    task: string;
    apikey: string;
    answer: ANSWER;
}

export interface QueryBody {
    task: string;
    apikey: string;
    query: string;
}

export interface QueryResponse {
    reply: any;
    error: string;
}

export interface HeadquartersResponse {
    code: number;
    message: string;
}