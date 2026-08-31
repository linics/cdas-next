# Isolated v3 trial on `platformilc_tencent`

This Docker stack is isolated from PlatformILC, shared databases and GitHub.
It binds only `127.0.0.1:3001` for SSH-tunnel access and uses local PostgreSQL
credentials and opaque sessions—no Clerk or DeepSeek key is present.

Create the private server environment once:

```bash
mkdir -p /home/ubuntu/cdas-next-v3-trial-private
chmod 700 /home/ubuntu/cdas-next-v3-trial-private
deploy/trial/bootstrap-runtime-env.sh \
  /home/ubuntu/cdas-next-v3-trial-private/runtime.env <deployment-id>
```

The script writes mode-`0600` database credentials. Run the compose commands
with that file, then initialize the one shared administrator interactively:

```bash
trial_env=/home/ubuntu/cdas-next-v3-trial-private/runtime.env
sudo env TRIAL_RUNTIME_ENV_FILE="$trial_env" docker compose \
  --env-file "$trial_env" -f deploy/trial/compose.yaml up -d --build
sudo env TRIAL_RUNTIME_ENV_FILE="$trial_env" docker compose \
  --env-file "$trial_env" -f deploy/trial/compose.yaml run --rm \
  app pnpm admin:bootstrap -- --confirm-database cdas_next_v3_trial
```

The command asks for username and password without echoing the password. It
does not accept either value as a command-line argument. Teachers are then
created using school invitations, and students are created through the teacher
Excel workflow. Stop the trial with `docker compose ... down`; do not use
`down -v` without separate approval.
