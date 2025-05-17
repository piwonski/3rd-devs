export interface ReportBody<ANSWER> {
    task: string;
    apikey: string;
    answer: ANSWER;
}

export interface HeadquartersResponse {
    code: number;
    message: string;
}