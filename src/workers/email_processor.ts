import * as Bull from "bull";
import * as htmlToText from "html-to-text";
import * as t from "io-ts";
import * as nodemailer from "nodemailer";

import {
  AUTHMAIL_FROM,
  AUTHMAIL_REPLY_TO,
  AUTHMAIL_TEST_ADDRESS,
  ORGANIZATION_NAME,
  SERVICE_NAME,
  SMTP_CONNECTION_URL
} from "../config";
import { withDefaultEmailTemplate } from "../templates/html/default";
import { log } from "../utils/logger";

export const SendmailProcessorInputT = t.intersection([
  t.interface({
    content: t.string,
    subject: t.string,
    to: t.string
  }),
  t.partial({
    from: t.string,
    replyTo: t.string,
    isText: t.boolean,
    attachments: t.array(
      t.interface({
        filename: t.string,
        httpHeaders: t.union([t.undefined, t.record(t.string, t.string)]),
        path: t.string
      })
    )
  })
]);

export type SendmailProcessorInputT = t.TypeOf<typeof SendmailProcessorInputT>;

const nodedmailerTransporter = nodemailer.createTransport(SMTP_CONNECTION_URL);

export function SendmailProcessor(queueClient: Bull.Queue): void {
  queueClient.process("sendmail", job => {
    log.info("** sendmail processing job : %s", JSON.stringify(job));
    SendmailProcessorInputT.decode(job.data)
      .mapLeft(err => {
        log.error("** sendmail processor: cannot decode input");
        log.debug(
          "** error: %s:%s",
          JSON.stringify(err),
          JSON.stringify(job.data)
        );
      })
      .map(async sendmailProcessorInput => {
        const emailHtml = withDefaultEmailTemplate(
          sendmailProcessorInput.subject,
          ORGANIZATION_NAME,
          SERVICE_NAME,
          sendmailProcessorInput.content
        ).replace("''", "'");
        const message = {
          attachments: sendmailProcessorInput.attachments,
          from: sendmailProcessorInput.from || AUTHMAIL_FROM || "",
          html: sendmailProcessorInput.isText ? undefined : emailHtml,
          replyTo: sendmailProcessorInput.replyTo || AUTHMAIL_REPLY_TO || "",
          subject: sendmailProcessorInput.subject.replace("''", "'"),
          text: sendmailProcessorInput.isText ? sendmailProcessorInput.content : htmlToText.fromString(emailHtml),
          to: AUTHMAIL_TEST_ADDRESS || sendmailProcessorInput.to
        };
        log.debug("** sending email: %s", JSON.stringify(message));
        try {
          await nodedmailerTransporter.sendMail(message);
        } catch (e) {
          log.error("** sending mail: error: %s", JSON.stringify(e));
        }
      });
  });
}
