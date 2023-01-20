import { SQS, CloudWatch } from "aws-sdk";

export function triggerMetric(identifier: string, numberOfDocs: number) {
    const params = {
        MetricData: [
            {
                MetricName: 'trigger',
                Dimensions: [
                    {
                        Name: 'identifier',
                        Value: identifier
                    }
                ],
                Unit: 'None',
                Value: 1
            }
        ],
        Namespace: 'CeramicBenchmarkMetrics'
    };
    return params
}

export function createDocMetric(identifier: string) {
    const params = {
        MetricData: [
            {
                MetricName: 'create',
                Dimensions: [
                    {
                        Name: 'identifier',
                        Value: identifier
                    }
                ],
                Unit: 'None',
                Value: 1
            }
        ],
        Namespace: 'CeramicBenchmarkMetrics'
    };
    return params
}

export function readDocMetric(identifier: string) {
    const params = {
        MetricData: [
            {
                MetricName: 'read',
                Dimensions: [
                    {
                        Name: 'identifier',
                        Value: identifier
                    }
                ],
                Unit: 'None',
                Value: 1,
                StorageResolution: 1 // High resolution
            }
        ],
        Namespace: 'CeramicBenchmarkMetrics'
    };
    return params
}

export function updateDocMetric(identifier: string) {
    const params = {
        MetricData: [
            {
                MetricName: 'update',
                Dimensions: [
                    {
                        Name: 'identifier',
                        Value: identifier
                    }
                ],
                Unit: 'None',
                Value: 1,
                StorageResolution: 1 // High resolution
            }
        ],
        Namespace: 'CeramicBenchmarkMetrics'
    };
    return params
}