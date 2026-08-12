<script lang="ts">
  interface Props {
    body: string
  }

  let { body }: Props = $props()
</script>

<div id="page-content">{@html body}</div>
