type AuthFormProps = {
  action: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  children: React.ReactNode;
  defaultEmail?: string;
  defaultName?: string;
  email: string;
  name?: string;
  mode: "sign-in" | "sign-up";
  onEmailChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  password: string;
};

export function AuthForm(props: Readonly<AuthFormProps>) {
  return (
    <form className="auth-form" onSubmit={props.action}>
      {props.mode === "sign-up" ? (
        <div className="auth-field-group">
          <label className="auth-field-label" htmlFor="name">
            Full name
          </label>
          <input
            autoComplete="name"
            className="auth-input"
            id="name"
            name="name"
            onChange={(event) => props.onNameChange(event.target.value)}
            placeholder="Ada Lovelace"
            required
            type="text"
            value={props.name ?? ""}
          />
        </div>
      ) : null}

      <div className="auth-field-group">
        <label className="auth-field-label" htmlFor="email">
          Email
        </label>
        <input
          autoComplete="email"
          autoFocus
          className="auth-input"
          id="email"
          name="email"
          onChange={(event) => props.onEmailChange(event.target.value)}
          placeholder="you@someo.ne"
          required
          type="email"
          value={props.email}
        />
      </div>

      <div className="auth-field-group">
        <label className="auth-field-label" htmlFor="password">
          Password
        </label>
        <input
          autoComplete={props.mode === "sign-up" ? "new-password" : "current-password"}
          className="auth-input"
          id="password"
          minLength={10}
          name="password"
          onChange={(event) => props.onPasswordChange(event.target.value)}
          placeholder="••••••••••"
          required
          type="password"
          value={props.password}
        />
      </div>

      {props.children}
    </form>
  );
}
