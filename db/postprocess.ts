export async function postprocess(callback?: () => void | Promise<void>) {
	if (callback) await callback();
}
