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
    const { notebookId } = await req.json()
    
    if (!notebookId) {
      return new Response(
        JSON.stringify({ error: 'L\'ID du notebook est requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Mettre à jour le statut du notebook pour indiquer que la génération audio a commencé
    const { error: updateError } = await supabase
      .from('notebooks')
      .update({
        audio_overview_generation_status: 'generating'
      })
      .eq('id', notebookId)

    if (updateError) {
      console.error('Erreur lors de la mise à jour du statut du notebook:', updateError)
      throw updateError
    }

    // Récupérer l'URL du webhook de génération audio et l'authentification depuis les secrets
    const audioGenerationWebhookUrl = Deno.env.get('AUDIO_GENERATION_WEBHOOK_URL')
    const authHeader = Deno.env.get('NOTEBOOK_GENERATION_AUTH')

    if (!audioGenerationWebhookUrl || !authHeader) {
      console.error('URL du webhook de génération audio ou authentification manquante')
      return new Response(
        JSON.stringify({ error: 'Service de génération audio non configuré' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Démarrage de la génération d\'aperçu audio pour le notebook:', notebookId)

    // Démarrer la tâche en arrière-plan sans attendre
    EdgeRuntime.waitUntil(
      (async () => {
        try {
          // Appeler le webhook de génération audio externe
          const audioResponse = await fetch(audioGenerationWebhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-N8N-Webhook-Auth': authHeader,
            },
            body: JSON.stringify({
              notebook_id: notebookId,
              callback_url: `${supabaseUrl}/functions/v1/audio-generation-callback`
            })
          })

          if (!audioResponse.ok) {
            const errorText = await audioResponse.text()
            console.error('Échec du webhook de génération audio:', errorText)
            
            // Mettre à jour le statut en échec
            await supabase
              .from('notebooks')
              .update({ audio_overview_generation_status: 'failed' })
              .eq('id', notebookId)
          } else {
            console.log('Webhook de génération audio appelé avec succès pour le notebook:', notebookId)
          }
        } catch (error) {
          console.error('Erreur de génération audio en arrière-plan:', error)
          
          // Mettre à jour le statut en échec
          await supabase
            .from('notebooks')
            .update({ audio_overview_generation_status: 'failed' })
            .eq('id', notebookId)
        }
      })()
    )

    // Retourner immédiatement avec un statut de succès
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Génération audio démarrée',
        status: 'generating'
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Erreur dans generate-audio-overview:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Échec du démarrage de la génération audio' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})