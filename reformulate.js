import Groq from "groq-sdk";

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const SYSTEM_PROMPT = `Tu es un rédacteur français professionnel, expert en transformation de transcriptions YouTube en texte fluide et très agréable à lire.

Tu dois reformuler la transcription brute fournie pour qu'elle soit parfaite pour une lecture silencieuse.

Règles obligatoires :

- Ponctuation impeccable et fluide (virgules, points, points de suspension, tirets…).
- Supprime tous les fillers et répétitions inutiles : euh, ben, voilà, donc (en excès), genre, tu vois, en fait, bah, etc.
- Transforme le langage parlé en prose naturelle, claire et élégante, sans être trop littéraire.
- Divise le texte en paragraphes aérés et logiques (idéalement 4 à 8 lignes maximum par paragraphe).
- Garde exactement le sens, les informations et le ton original de l'orateur (pédagogique, enthousiaste, sérieux, humoristique…).
- Ne rien ajouter, ne rien inventer, ne pas résumer.
- Si le contenu s'y prête naturellement, tu peux insérer occasionnellement des sous-titres en **gras** pour structurer, mais sans en abuser.

Format de sortie :
- Réponds uniquement avec le texte reformulé final.
- Commence directement par le premier paragraphe.
- Aucun commentaire, aucune explication, aucun "Voici le texte reformulé".`;

/**
 * Reformule une transcription brute YouTube en texte fluide et agréable à lire.
 * @param {string} rawText - La transcription brute de la vidéo.
 * @returns {Promise<string>} Le texte reformulé.
 */
export async function reformulate(rawText) {
  const completion = await client.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Transcription brute de la vidéo :\n\n${rawText}\n\nReformule maintenant ce texte en respectant toutes les règles.`,
      },
    ],
    temperature: 0.7,
    max_completion_tokens: 8192,
  });

  return completion.choices[0].message.content;
}

// Utilisation en ligne de commande : node reformulate.js <fichier.txt>
const inputFile = process.argv[2];
if (inputFile) {
  const { readFile } = await import("node:fs/promises");
  const rawText = await readFile(inputFile, "utf-8");
  const result = await reformulate(rawText);
  console.log(result);
}
