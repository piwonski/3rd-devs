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

export interface LoopApiBody {
    apikey: string;
    query: string;       
}

export interface LoopApiResponse {
    code: number;
    message: string;
}

export interface User {
    id: string,
    username: string,
    access_level: string,
    is_active: number,
    lastlog: string,
}