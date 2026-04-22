import { type ComponentPropsWithoutRef, forwardRef } from "react";

type FormProps = Omit<ComponentPropsWithoutRef<"form">, "action"> & {
	action?: string | ((formData: FormData) => void | Promise<void>);
};

const Form = forwardRef<HTMLFormElement, FormProps>(function Form(props, ref) {
	const { action, ...rest } = props;

	return <form action={action} ref={ref} {...rest} />;
});

export default Form;
