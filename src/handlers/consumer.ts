import { Context, SQSEvent } from "aws-lambda";
import { CloudWatch } from "aws-sdk";
import { createCeramic } from "../create-ceramic.js";
import { TileDocument } from "@ceramicnetwork/stream-tile";
import {randomBytes} from "@stablelib/random";

const cloudwatch = new CloudWatch();

export async function consumer(event: SQSEvent, context: Context) {
  for (const record of event.Records) {
    const runID = context.awsRequestId
    const body = JSON.parse(record.body);
    console.log("Params: ", body);
    const seed = randomBytes(32);
    const ceramic = await createCeramic(body.endpoint, seed);

    const content0 = {
      foo: `hello-${Math.random()}`,
    };
    const tile = await TileDocument.create(ceramic, content0, undefined, {
      anchor: false,
      publish: false,
    });

    var createParams = {
      MetricData: [
          {
              MetricName: 'consumer-create',
              Dimensions: [
                {
                    Name: 'run',
                    Value: runID
                }
            ],              
              Unit: 'None',
              Value: 1
          }
      ],
      Namespace: 'CeramicBenchmarkMetrics'
  };

    console.log(await cloudwatch.putMetricData(createParams).promise())

    const content1 = { foo: `world-${Math.random()}` };
    await tile.update(content1, undefined, { anchor: false, publish: false });

    var updateParams = {
      MetricData: [
          {
              MetricName: 'consumer-update',
              Dimensions: [
                {
                    Name: 'run',
                    Value: runID
                }
            ],              
              Unit: 'None',
              Value: 1
          }
      ],
      Namespace: 'CeramicBenchmarkMetrics'
  };

    console.log(await cloudwatch.putMetricData(updateParams).promise())


    console.log("ceramic payload:", tile.state);
  }
}
