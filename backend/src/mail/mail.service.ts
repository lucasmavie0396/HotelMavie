import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailStatus } from '@prisma/client';
import { createTransport, Transporter } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';

export interface MailInput {
  hotelId?: number | null;
  kind: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string | null;
  relatedId?: number;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  readonly configured: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const host = this.config.get<string>('SMTP_HOST');
    this.configured = Boolean(host);
    this.transporter = host
      ? createTransport({
          host,
          port: Number(this.config.get('SMTP_PORT') ?? 587),
          secure: this.config.get('SMTP_SECURE') === 'true',
          auth: this.config.get('SMTP_USER')
            ? { user: this.config.get<string>('SMTP_USER'), pass: this.config.get<string>('SMTP_PASS') }
            : undefined,
        })
      : createTransport({ jsonTransport: true });
  }

  async send(input: MailInput) {
    let status: EmailStatus = this.configured ? EmailStatus.SENT : EmailStatus.LOGGED;
    let error: string | undefined;
    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('MAIL_FROM') ?? 'MAVIE-HGest <no-reply@localhost>',
        to: input.to,
        replyTo: input.replyTo ?? undefined,
        subject: input.subject,
        html: input.html,
        attachments: input.attachments,
      });
    } catch (e) {
      status = EmailStatus.FAILED;
      error = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Falha a enviar email ${input.kind} para ${input.to}: ${error}`);
    }
    return this.prisma.emailLog.create({
      data: {
        hotelId: input.hotelId ?? null,
        kind: input.kind,
        recipient: input.to,
        subject: input.subject,
        status,
        error,
        relatedId: input.relatedId,
      },
    });
  }

  queue(input: MailInput) {
    this.send(input).catch((e) => this.logger.error(`Erro ao registar email ${input.kind}: ${e}`));
  }
}
