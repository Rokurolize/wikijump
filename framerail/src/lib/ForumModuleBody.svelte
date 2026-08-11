<script lang="ts">
  interface Props {
    body: string
  }

  let { body }: Props = $props()
</script>

{@html body}
