import { SendIcon } from "./chat-icons";

export function SubmitButton(props: Readonly<{
  children: React.ReactNode;
  disabled?: boolean;
  isSuccessful?: boolean;
  pending?: boolean;
}>) {
  const isDisabled = props.disabled || props.pending || props.isSuccessful;

  return (
    <button
      aria-disabled={isDisabled}
      className="auth-submit-button"
      disabled={isDisabled}
      type={props.pending ? "button" : "submit"}
    >
      {props.children}
      {(props.pending || props.isSuccessful) ? (
        <span className="auth-submit-button-icon auth-submit-button-icon-spin">
          <SendIcon />
        </span>
      ) : null}
      <output aria-live="polite" className="sr-only">
        {props.pending || props.isSuccessful ? "Loading" : "Submit form"}
      </output>
    </button>
  );
}
