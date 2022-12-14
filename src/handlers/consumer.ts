import { SQSEvent } from "aws-lambda";
import { createCeramic } from "../create-ceramic.js";
import { TileDocument } from "@ceramicnetwork/stream-tile";
import {randomBytes} from "@stablelib/random";

export async function consumer(event: SQSEvent) {
  for (const record of event.Records) {
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
    const content1 = { foo: `world-${Math.random()}` };
    await tile.update(content1, undefined, { anchor: false, publish: false });

    console.log("ceramic payload:", tile.state);
  }
}
