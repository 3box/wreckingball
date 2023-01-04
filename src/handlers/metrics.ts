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
                Value: numberOfDocs
            }
        ],
        Namespace: 'CeramicBenchmarkMetrics'
    };
    return params
}