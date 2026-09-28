import { type FC, useContext } from "react";
import { ThreadSettingsContext } from "./thread-context";

export const ThreadWelcome: FC = () => {
	const { welcomeMessage } = useContext(ThreadSettingsContext);

	return (
		<div className="aui-thread-welcome-root mb-5 flex flex-1 flex-col items-center justify-center px-3 text-center sm:mb-6">
			<h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-balance text-2xl font-semibold leading-8 tracking-normal duration-200 sm:text-[28px] sm:leading-9">
				{welcomeMessage}
			</h1>
		</div>
	);
};
