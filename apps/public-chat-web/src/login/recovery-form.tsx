import Form from "next/form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FIELD_CLASS_NAME =
  "h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted";

export function PasswordRecoveryRequestForm(props: {
  action: NonNullable<
    string | ((formData: FormData) => void | Promise<void>) | undefined
  >;
  children: React.ReactNode;
  defaultEmail?: string;
}) {
  const { action, children, defaultEmail = "" } = props;

  return (
    <Form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label className="font-normal text-muted-foreground" htmlFor="email">
          Email
        </Label>
        <Input
          autoComplete="email"
          autoFocus
          className={FIELD_CLASS_NAME}
          defaultValue={defaultEmail}
          id="email"
          name="email"
          placeholder="you@someo.ne"
          required
          type="email"
        />
      </div>

      {children}
    </Form>
  );
}

export function PasswordRecoveryResetForm(props: {
  action: NonNullable<
    string | ((formData: FormData) => void | Promise<void>) | undefined
  >;
  children: React.ReactNode;
}) {
  const { action, children } = props;

  return (
    <Form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label className="font-normal text-muted-foreground" htmlFor="password">
          New password
        </Label>
        <Input
          autoComplete="new-password"
          autoFocus
          className={FIELD_CLASS_NAME}
          id="password"
          name="password"
          placeholder="Create a new password"
          required
          type="password"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label
          className="font-normal text-muted-foreground"
          htmlFor="confirmPassword"
        >
          Confirm password
        </Label>
        <Input
          autoComplete="new-password"
          className={FIELD_CLASS_NAME}
          id="confirmPassword"
          name="confirmPassword"
          placeholder="Repeat your new password"
          required
          type="password"
        />
      </div>

      {children}
    </Form>
  );
}
