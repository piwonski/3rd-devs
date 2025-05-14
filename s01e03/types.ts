export interface TestItem {
    question: string;
    answer: number;
    test?: TestQuestion;
}

export interface TestQuestion {
    q: string;
    a: string;
}

export interface CalibrationData {
    apikey: string;
    description: string;
    copyright: string;
    "test-data": TestItem[];
}

export interface ReportBody {
    task: string;
    apikey: string;
    answer: CalibrationData;
}

export interface HeadquartersResponse {
    code: number;
    message: string;
}