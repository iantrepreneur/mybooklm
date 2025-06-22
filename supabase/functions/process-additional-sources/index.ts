import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Gérer les requêtes préliminaires CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, notebookId, urls, title, content, timestamp, sourceIds } = await req.json();
    
    console.log(`Traitement de sources supplémentaires: requête ${type} reçue pour le notebook ${notebookId}`);

    // Récupérer l'URL du webhook depuis les secrets Supabase
    const webhookUrl = Deno.env.get('ADDITIONAL_SOURCES_WEBHOOK_URL');
    if (!webhookUrl) {
      throw new Error('ADDITIONAL_SOURCES_WEBHOOK_URL non configurée');
    }

    // Récupérer le jeton d'authentification depuis les secrets Supabase (même que generate-notebook-content)
    const authToken = Deno.env.get('NOTEBOOK_GENERATION_AUTH');
    if (!authToken) {
      throw new Error('NOTEBOOK_GENERATION_AUTH non configurée');
    }

    // Préparer le payload du webhook
    let webhookPayload;
    
    if (type === 'multiple-websites') {
      webhookPayload = {
        type: 'multiple-websites',
        notebookId,
        urls,
        sourceIds, // Tableau d'IDs de sources correspondant aux URLs
        timestamp
      };
    } else if (type === 'copied-text') {
      webhookPayload = {
        type: 'copied-text',
        notebookId,
        title,
        content,
        sourceId: sourceIds?.[0], // ID de source unique pour le texte copié
        timestamp
      };
    } else {
      throw new Error(`Type non pris en charge: ${type}`);
    }

    console.log('Envoi du payload au webhook:', JSON.stringify(webhookPayload, null, 2));

    // Envoyer au webhook avec authentification
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authToken,
        ...corsHeaders
      },
      body: JSON.stringify(webhookPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Échec de la requête webhook:', response.status, errorText);
      throw new Error(`Échec de la requête webhook: ${response.status} - ${errorText}`);
    }

    const webhookResponse = await response.text();
    console.log('Réponse du webhook:', webhookResponse);

    return new Response(JSON.stringify({ 
      success: true, 
      message: `Données ${type} envoyées au webhook avec succès`,
      webhookResponse 
    }), {
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders 
      },
    });

  } catch (error) {
    console.error('Erreur de traitement des sources supplémentaires:', error);
    
    return new Response(JSON.stringify({ 
      error: error.message,
      success: false 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders 
      },
    });
  }
});