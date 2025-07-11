import { file } from "bun";

export async function loadTemplate(name: string): Promise<string> {
	return file(`src/templates/${name}.hbs`).text();
}
