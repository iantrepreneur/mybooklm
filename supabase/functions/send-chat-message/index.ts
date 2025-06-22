import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { session_id, message, user_id } = await req.json();
    
    console.log('Message reçu:', { session_id, message, user_id });

    // Récupérer l'URL du webhook et l'en-tête d'authentification depuis l'environnement
    const webhookUrl = Deno.env.get('NOTEBOOK_CHAT_URL');
    const authHeader = Deno.env.get('NOTEBOOK_GENERATION_AUTH');
    
    if (!webhookUrl) {
      throw new Error('Variable d\'environnement NOTEBOOK_CHAT_URL non définie');
    }

    if (!authHeader) {
      throw new Error('Variable d\'environnement NOTEBOOK_GENERATION_AUTH non définie');
    }

    console.log('Envoi vers le webhook avec en-tête d\'authentification');

    // Envoyer le message au webhook n8n avec authentification
    // Utiliser l'en-tête Authorization au lieu de X-N8N-Webhook-Auth
    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({
        session_id,
        message,
        user_id,
        timestamp: new Date().toISOString()
      })
    });

    if (!webhookResponse.ok) {
      console.error(`Le webhook a répondu avec le statut: ${webhookResponse.status}`);
      const errorText = await webhookResponse.text();
      console.error('Réponse d\'erreur du webhook:', errorText);
      throw new Error(`Le webhook a répondu avec le statut: ${webhookResponse.status}`);
    }

    const webhookData = await webhookResponse.json();
    console.log('Réponse du webhook:', webhookData);

    return new Response(
      JSON.stringify({ success: true, data: webhookData }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    );

  } catch (error) {
    console.error('Erreur dans send-chat-message:', error);
    
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Échec de l\'envoi du message au webhook' 
      }),
      { 
        status: 500,
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        }
      }
    );
  }
});