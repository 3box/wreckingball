import { SQSEvent } from "aws-lambda";
import { createCeramic } from "../create-ceramic.js";
import { TileDocument } from "@ceramicnetwork/stream-tile";

export async function consumer(event: SQSEvent) {
  for (const record of event.Records) {
    const ceramic = await createCeramic();

    const content0 = {
      foo: `hello-${Math.random()}`,
    };
    const tile = await TileDocument.create(ceramic, content0, undefined, {
      anchor: false,
      publish: false,
    });
    const content1 = { foo: `world-${Math.random()}` };
    await tile.update(content1, undefined, { anchor: false, publish: false });

    const messageAttributes = record.messageAttributes;
    console.log(
      "Message Attribute: ",
      messageAttributes.AttributeName.stringValue
    );
    console.log("Message Body: ", record.body);
    console.log("ceramic payload:", tile.state);
  }
}
