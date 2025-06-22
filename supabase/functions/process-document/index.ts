import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { sourceId, filePath, sourceType } = await req.json()

    if (!sourceId || !filePath || !sourceType) {
      return new Response(
        JSON.stringify({ error: 'sourceId, filePath et sourceType sont requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Traitement du document:', { source_id: sourceId, file_path: filePath, source_type: sourceType });

    // Récupérer les variables d'environnement
    const webhookUrl = Deno.env.get('DOCUMENT_PROCESSING_WEBHOOK_URL')
    const authHeader = Deno.env.get('NOTEBOOK_GENERATION_AUTH')

    if (!webhookUrl) {
      console.error('Variable d\'environnement DOCUMENT_PROCESSING_WEBHOOK_URL manquante')
      
      // Initialiser le client Supabase pour mettre à jour le statut
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )

      // Mettre à jour le statut de la source en échec
      await supabaseClient
        .from('sources')
        .update({ processing_status: 'failed' })
        .eq('id', sourceId)

      return new Response(
        JSON.stringify({ error: 'URL du webhook de traitement de document non configurée' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!authHeader) {
      console.error('En-tête d\'authentification manquant - variable d\'environnement NOTEBOOK_GENERATION_AUTH non définie')
      
      // Initialiser le client Supabase pour mettre à jour le statut
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )

      // Mettre à jour le statut de la source en échec
      await supabaseClient
        .from('sources')
        .update({ processing_status: 'failed' })
        .eq('id', sourceId)

      return new Response(
        JSON.stringify({ error: 'Authentification non configurée pour le traitement de document' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Appel du webhook externe:', webhookUrl);
    console.log('Utilisation de l\'en-tête d\'authentification (10 premiers caractères):', authHeader.substring(0, 10) + '...');

    // Créer l'URL du fichier pour l'accès public
    const fileUrl = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/sources/${filePath}`

    // Préparer le payload pour le webhook avec les noms de variables corrects
    const payload = {
      source_id: sourceId,
      file_url: fileUrl,
      file_path: filePath,
      source_type: sourceType,
      callback_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/process-document-callback`
    }

    console.log('Payload du webhook:', payload);

    // Appeler le webhook externe avec les en-têtes appropriés
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': authHeader
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Échec de l\'appel du webhook:', response.status, response.statusText, errorText);
      
      // Initialiser le client Supabase pour mettre à jour le statut
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )

      // Mettre à jour le statut de la source en échec
      await supabaseClient
        .from('sources')
        .update({ processing_status: 'failed' })
        .eq('id', sourceId)

      // Fournir des messages d'erreur plus spécifiques
      let errorMessage = 'Échec du traitement du document';
      if (response.status === 401 || response.status === 403) {
        errorMessage = 'Échec de l\'authentification - veuillez vérifier la configuration du webhook';
      } else if (response.status >= 500) {
        errorMessage = 'Erreur du service externe - veuillez réessayer plus tard';
      }

      return new Response(
        JSON.stringify({ 
          error: errorMessage, 
          details: errorText,
          status: response.status 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const result = await response.json()
    console.log('Réponse du webhook:', result);

    return new Response(
      JSON.stringify({ success: true, message: 'Traitement du document initié', result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Erreur dans la fonction process-document:', error)
    
    // Essayer de mettre à jour le statut de la source en échec si nous avons le sourceId
    try {
      const body = await req.json()
      if (body.sourceId) {
        const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )
        
        await supabaseClient
          .from('sources')
          .update({ processing_status: 'failed' })
          .eq('id', body.sourceId)
      }
    } catch (updateError) {
      console.error('Échec de la mise à jour du statut de la source:', updateError)
    }
    
    return new Response(
      JSON.stringify({ error: 'Erreur interne du serveur', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})