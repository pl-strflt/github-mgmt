resource "github_team" "this" {
  lifecycle {
    ignore_changes = [
      description,
      privacy,
    ]
  }
}
