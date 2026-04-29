import { getSessionPrincipal } from "./api";
import { mapSessionPrincipal } from "./mappers";

export async function loadShellSession() {
	const principal = await getSessionPrincipal();
	return mapSessionPrincipal(principal);
}
